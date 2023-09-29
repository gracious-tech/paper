
# Args
ARG PYTHON_VERSION="3.11"


## Create temporary image for building assets that require compilation
# We'll install all the python modules at this step since the whole venv will be copied to new image
# But all the distro packages needed to compile the python modules will be discarded

FROM python:${PYTHON_VERSION}-alpine AS build-image

# Install only the distro modules needed to build the python modules
RUN apk add --no-cache libstdc++ make cmake build-base libtool autoconf automake elfutils-dev git

# Create dir for function
RUN mkdir -p /home/app/

# Install all required python modules
RUN python3 -m pip install --target /home/app/ \
    awslambdaric boto3 pypdf "weasyprint@git+https://github.com/Kozea/WeasyPrint"


## Create image that will actually be deployed

# Grab a fresh copy of the Python image
FROM python:${PYTHON_VERSION}-alpine

# Copy in the built python modules from the build image
COPY --from=build-image /home/app/ /home/app/

# Install distro modules needed at runtime (weasy deps, fonts)
RUN apk add --no-cache \
    libstdc++ pango zlib-dev jpeg-dev openjpeg-dev libffi-dev \
    font-noto-all font-noto-cjk msttcorefonts-installer

# Copy in fonts that aren't available in the distro
COPY fonts/ /usr/share/fonts/

# Get Alpine to recognise the new fonts
RUN update-ms-fonts
RUN fc-cache --really-force --verbose

# Copy in the actual function
COPY main.py /home/app/

# Execution settings
WORKDIR /home/app/
ENTRYPOINT ["/usr/local/bin/python", "-m", "awslambdaric"]
CMD ["main.entry"]
