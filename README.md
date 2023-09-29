
# Paper Bible

Source code for [paper.bible](https://paper.bible)


## Setup for developers

1. Copy and rename config templates `app/.env.development.local.template` and `generator/config.yaml.template`. You'll discover the values required while setting up the backend in the next steps.

2. Run the app locally with `.bin/serve_app_prod`. If it can connect to the fetch(bible) collection then it should be fully functional aside from actually generating documents.

4. Deploy a dev version of the backend with `.bin/deploy_generator`. Pass the AWS credentials required as environment variables. You'll need permission to create a bucket and a lambda function.

    The backend can't yet be run locally due to complexities with request size limits and access to S3's API.

The app should then be able to generate documents and display them.
