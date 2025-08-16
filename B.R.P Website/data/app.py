import os
import logging
from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

# Set up logging
logging.basicConfig(level=logging.DEBUG)

# create the app
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "arm-swing-dashboard-secret-key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Import routes
from routes import *
