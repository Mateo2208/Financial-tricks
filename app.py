from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)

# Enable CORS for all routes
CORS(app, resources={
    r"/proxy/*": {
        "origins": "*",
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Accept"]
    }
})

@app.route('/proxy/gsheet', methods=['POST', 'OPTIONS'])
def proxy_gsheet():
    """
    Proxy endpoint for Google Sheets Apps Script
    Forwards POST requests to the Google Apps Script URL
    """
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Accept')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 200
    
    try:
        # Get JSON data from the request
        data = request.get_json()
        
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No data provided'
            }), 400
        
        # Forward the request to Google Apps Script
        gs_response = requests.post(
            GS_URL,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=30  # 30 seconds timeout
        )
        
        # Check if the request was successful
        gs_response.raise_for_status()
        
        # Return the response from Google Apps Script
        response_data = gs_response.json()
        return jsonify(response_data), gs_response.status_code
        
    except requests.exceptions.Timeout:
        return jsonify({
            'status': 'error',
            'message': 'Request timeout - Google Sheets took too long to respond'
        }), 504
        
    except requests.exceptions.RequestException as e:
        return jsonify({
            'status': 'error',
            'message': f'Error connecting to Google Sheets: {str(e)}'
        }), 502
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Internal server error: {str(e)}'
        }), 500

# Google Apps Script URL (shared)
GS_URL = 'https://script.google.com/macros/s/AKfycbx1mcLQIt5cFTC_jKhSfj5ZXuMR3EIsBGPM_0Lx7Cms9q9WcCtnEhYGvUclOOr3fm6I/exec'

@app.route('/proxy/gsheet/batch', methods=['POST', 'OPTIONS'])
def proxy_gsheet_batch():
    """
    Batch proxy endpoint for Google Sheets Apps Script
    Accepts an array of entries and sends each one to the Google Apps Script
    """
    if request.method == 'OPTIONS':
        response = jsonify({'status': 'ok'})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Accept')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        return response, 200

    try:
        data = request.get_json()

        if not data or not isinstance(data, list):
            return jsonify({
                'status': 'error',
                'message': 'Expected an array of entries'
            }), 400

        if len(data) > 50:
            return jsonify({
                'status': 'error',
                'message': 'Maximum 50 entries per batch'
            }), 400

        results = []
        errors = []

        for i, entry in enumerate(data):
            try:
                gs_response = requests.post(
                    GS_URL,
                    json=entry,
                    headers={'Content-Type': 'application/json'},
                    timeout=30
                )
                gs_response.raise_for_status()
                results.append({'index': i, 'status': 'success', 'data': gs_response.json()})
            except requests.exceptions.Timeout:
                errors.append({'index': i, 'status': 'error', 'message': 'Timeout'})
            except requests.exceptions.RequestException as e:
                errors.append({'index': i, 'status': 'error', 'message': str(e)})

        status_code = 200 if not errors else 207
        return jsonify({
            'status': 'partial' if errors else 'success',
            'results': results,
            'errors': errors,
            'total': len(data),
            'successful': len(results),
            'failed': len(errors)
        }), status_code

    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Internal server error: {str(e)}'
        }), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Financial Tricks API is running'
    }), 200

@app.route('/', methods=['GET'])
def index():
    """Root endpoint - shows available routes"""
    return jsonify({
        'message': 'Financial Tricks API',
        'endpoints': {
            '/proxy/gsheet': 'POST - Proxy to Google Sheets (single)',
            '/proxy/gsheet/batch': 'POST - Proxy to Google Sheets (batch)',
            '/health': 'GET - Health check'
        }
    }), 200

if __name__ == '__main__':
    # Run the Flask app in debug mode
    app.run(
        host='0.0.0.0',  # Allow external connections
        port=5000,       # Port 5000
        debug=True       # Enable debug mode for development
    )
