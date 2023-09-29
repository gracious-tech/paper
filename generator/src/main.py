
import re
import os
import json
import traceback
from io import BytesIO
from base64 import urlsafe_b64encode
from datetime import datetime

import boto3
from botocore.config import Config
from pypdf import PdfWriter, PdfReader, PageObject, annotations
from weasyprint import HTML


# Access env vars
REGION = os.environ['REGION']
BUCKET_NAME = os.environ['BUCKET_NAME']


# Access to S3
# NOTE Important to set region to avoid unnecessary redirects
AWS_CONFIG = Config(region_name=REGION)
S3 = boto3.client('s3', config=AWS_CONFIG)


def entry(event, context):
    """Initial handling of S3 object creation

    Do the bare minimum required to write the result file so client knows processing has finished

    """

    # Get request data
    object_data = event['Records'][0]['s3']['object']
    object_key = object_data['key']
    object_etag = object_data['eTag']

    # Shorten etag to url64
    url64_etag = urlsafe_b64encode(bytes.fromhex(object_etag)).decode('ascii').replace('=', '~')

    # Form creation id from 2 chars of request id and whole etag
    # The 2 chars of request id is enough to ensure same data/etag from single user still unique
    # And the etag ensures malicious users can't overwrite someone's shared creation with diff data
    creation_id = object_key.rpartition('/')[2][:2] + url64_etag

    # Do everything else within exception handler since now have enough to write result file
    try:

        # Get and parse the request data
        request = json.loads(S3.get_object(Bucket=BUCKET_NAME, Key=object_key)['Body'].read())

        # Handle the request
        result = handle_request(request, creation_id)

        # Handled request without failure so can delete the request file
        S3.delete_object(Bucket=BUCKET_NAME, Key=object_key)
    except:
        # Failed to process request so write error data instead
        result = {
            'error': traceback.format_exc(),
        }

    # Write result file, whether failed or success
    S3.put_object(
        Bucket=BUCKET_NAME,
        Key=f'creations/{creation_id}.result.json',
        Body=json.dumps(result),
        ContentType='application/json',
    )


def handle_request(request, creation_id):
    """Main request handling"""

    # Unpack request, none of which is trusted, so don't bother validating
    title = request['title']
    booklet = request['booklet']
    subjobs = request['subjobs']

    # Generate single blank page (required for detecting page size and also when lines desired)
    blank_page_stream, ignored = html_to_stream(request['blank_job'], 1)
    blank_page = PdfReader(blank_page_stream).pages[0]

    # Create new pdf writer to concat pdfs created by Weasy
    pdf_writer = PdfWriter()

    # Render each subjob separately and arrange so each side displayed when booklet opened
    # NOTE rhs is one of: False (lhs flows across rhs as well), None (rhs blank), string (html)
    for lhs, rhs, alone in subjobs:

        # If alone requested, must ensure start on even page so not printed on reverse side
        if alone and len(pdf_writer.pages) % 2 == 1:
            pdf_writer.add_page(blank_page)

        # Render lhs which will always exist
        lhs_stream, lhs_num_pages = html_to_stream(lhs)
        lhs_pages = PdfReader(lhs_stream).pages

        # Render rhs
        if rhs:
            rhs_stream, rhs_num_pages = html_to_stream(rhs)
            rhs_pages = PdfReader(rhs_stream).pages
        elif rhs is None:
            rhs_num_pages = 1
            rhs_pages = [blank_page]  # Only need one to trigger blanks for rest
        else:
            rhs_num_pages = 0
            rhs_pages = []

        # Need to ensure odd number of pages so lhs & rhs open next to each other when booklet
        if rhs != False and booklet and len(pdf_writer.pages) % 2 != 1:
            pdf_writer.add_page(blank_page)

        # Add pages, alternating between sides
        for i in range(max(lhs_num_pages, rhs_num_pages)):

            # Make sure lhs and rhs are equal in length by adding blank pages when exhausted
            if i < len(lhs_pages):
                pdf_writer.add_page(lhs_pages[i])
            else:
                pdf_writer.add_page(blank_page)
            if i < len(rhs_pages):
                pdf_writer.add_page(rhs_pages[i])
            elif rhs_num_pages:  # rhs does exist and shouldn't just flow lhs across both
                pdf_writer.add_page(blank_page)

        # If alone, ensure next subjob starts on separate piece of paper
        if alone and max(lhs_num_pages, rhs_num_pages) % 2 != 0:
            pdf_writer.add_page(blank_page)

    # Optionally convert to booklet format
    if booklet:

        # Ensure pages is multiple of 4 so ordering works correctly
        while len(pdf_writer.pages) % 4:
            pdf_writer.add_page(blank_page)

        # Determine new page size
        old_width = pdf_writer.pages[0].mediabox.width
        new_width = old_width * 2
        new_height = pdf_writer.pages[0].mediabox.height

        # Join pages and order for folding
        new_writer = PdfWriter()
        for i in range(len(pdf_writer.pages) // 2):

            # Get next pages from start and end (since folding)
            lhs = pdf_writer.pages[i * -1 - 1]
            rhs = pdf_writer.pages[i]

            # Flip order for odd pages which will be printed on other side of paper
            if i % 2:
                lhs, rhs = rhs, lhs

            # Merge onto a new page
            # WARN New page required for printers not to get confused, even if looks ok on screen
            new_page = PageObject.create_blank_page(None, new_width, new_height)
            new_page.merge_translated_page(lhs, 0, 0)
            new_page.merge_translated_page(rhs, old_width, 0)
            new_writer.add_page(new_page)

        # Replace original writer
        pdf_writer = new_writer

    # Add non-printable instructions on first page
    first_box = pdf_writer.pages[0].mediabox
    edge = "short" if booklet else "long"
    pdf_writer.add_annotation(0, annotations.Text(
        text=(
            f"Print this out two-sided ({edge} edge)\n\n"
            "If using different paper for the cover, "
            "print the first 2 pages separate from the others.\n\n"
            "(created with paper.bible)"
        ),
        rect=(50, first_box.top - 50, 50, first_box.top - 50),
        open=True,
    ))

    # Add metadata
    pdf_writer.add_metadata({
        '/Title': title,
        '/Producer': "paper.bible",
        '/CreationDate': datetime.now().strftime(f"D\072%Y%m%d%H%M%S"),
    })

    # Set default duplex setting
    pdf_writer.create_viewer_preferences()
    pdf_writer.viewer_preferences.duplex = \
        '/DuplexFlipShortEdge' if booklet else '/DuplexFlipLongEdge'

    # Detect how many pages in final PDF
    num_pages = len(pdf_writer.pages)

    # Convert pypdf writer object to base64 encoded string
    stream = BytesIO()
    pdf_writer.write_stream(stream)

    # Save PDF to bucket
    filename = re.sub('[^a-zA-Z0-9 -]', '', title).strip() or "Paper Bible"
    S3.put_object(
        Bucket=BUCKET_NAME,
        Key=f'creations/{creation_id}.pdf',
        Body=stream.getvalue(),
        ContentType='application/pdf',
        ContentDisposition=f'inline; filename="{filename}.pdf"',
    )

    # Save blueprint data to bucket so can recreate or share if needed
    S3.put_object(
        Bucket=BUCKET_NAME,
        Key=f'creations/{creation_id}.blue.json',
        Body=request['blue'],
        ContentType='application/json',
    )

    # Return result data
    return {
        'pages': num_pages,
    }


def html_to_stream(html, cap=None):
    """Render html to a PDF bytes stream using Weasy Print and also report number of pages"""
    weasy_html = HTML(string=html, url_fetcher=block_network_access)
    weasy_doc = weasy_html.render()
    num_pages = len(weasy_doc.pages)

    # Optionally limit to a certain number of pages
    if cap and num_pages > cap:
        del weasy_doc.pages[cap:]

    pdf_bytes = weasy_doc.write_pdf()
    return (BytesIO(pdf_bytes), num_pages)


def block_network_access(url):
    """Dud URL fetcher for Weasy Print that just disables network access for security"""
    raise Exception("Network access disabled")
