import os
import json
import requests
import logging
from flask import render_template, jsonify, request
from app import app

logger = logging.getLogger(__name__)

# Default Google Apps Script URL from the provided files
DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyGICmPIv5MoAG_g00EYbAM05sFYT9bZjBoAadXZyUFtRIloLAPKQfAzX1lkgUMqN1e5Q/exec"

@app.route('/')
def dashboard():
    """Serve the main dashboard page"""
    return render_template('dashboard.html')

@app.route('/api/data')
def get_data():
    """Proxy endpoint to fetch data from Google Apps Script and avoid CORS issues"""
    try:
        # Get the script URL from query params or use default
        script_url = request.args.get('url', DEFAULT_SCRIPT_URL)
        limit = request.args.get('limit', '200')
        
        logger.debug(f"Fetching data from: {script_url}")
        
        # Prepare the request payload for Google Apps Script
        payload = {
            'action': 'read',
            'limit': limit
        }
        
        # Make POST request to Google Apps Script
        response = requests.post(
            script_url,
            json=payload,
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout=30
        )
        
        logger.debug(f"Response status: {response.status_code}")
        logger.debug(f"Response headers: {response.headers}")
        
        if response.status_code == 200:
            try:
                data = response.json()
                logger.debug(f"Successfully parsed JSON data with {len(data.get('data', []))} records")
                logger.debug(f"Raw response data: {data}")
                if data.get('data') and len(data['data']) > 0:
                    logger.debug(f"Sample data record: {data['data'][0]}")
                return jsonify(data)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON response: {e}")
                logger.error(f"Response text: {response.text[:500]}")
                return jsonify({
                    'error': 'Invalid JSON response from Google Apps Script',
                    'details': str(e),
                    'response_preview': response.text[:200]
                }), 500
        else:
            logger.error(f"HTTP error {response.status_code}: {response.text}")
            return jsonify({
                'error': f'HTTP {response.status_code} from Google Apps Script',
                'details': response.text[:200]
            }), response.status_code
            
    except requests.exceptions.Timeout:
        logger.error("Request to Google Apps Script timed out")
        return jsonify({
            'error': 'Request timed out',
            'details': 'The Google Apps Script took too long to respond'
        }), 504
        
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Connection error: {e}")
        return jsonify({
            'error': 'Connection failed',
            'details': 'Could not connect to Google Apps Script endpoint'
        }), 503
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return jsonify({
            'error': 'Internal server error',
            'details': str(e)
        }), 500

@app.route('/api/health')
def health_check():
    """Simple health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'arm-swing-dashboard'
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500
