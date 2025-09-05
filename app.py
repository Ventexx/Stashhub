from flask import Flask, render_template, request, jsonify, send_from_directory
import json
import os
import requests
from datetime import datetime

app = Flask(__name__)
DATA_FILE = 'data.json'

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {"name": "Root", "cover": "", "folders": [], "entries": []}
    return {"name": "Root", "cover": "", "folders": [], "entries": []}

def save_data(data):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/load', methods=['GET'])
def load():
    data = load_data()
    # Auto-upgrade old format if needed
    if "folders" in data and "entries" not in data:
        data = {"name": "Root", "cover": "", "folders": data["folders"], "entries": []}
        save_data(data)
    return jsonify(data)

@app.route('/save', methods=['POST'])
def save():
    data = request.get_json()
    save_data(data)
    return jsonify({"status": "ok"})

@app.route('/load-global-settings', methods=['GET'])
def load_global_settings():
    try:
        if os.path.exists('./global_settings.json'):
            with open('./global_settings.json', 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
        else:
            return jsonify({"error": "Global settings not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-global-settings', methods=['POST'])
def save_global_settings():
    try:
        settings_data = request.get_json()
        with open('./global_settings.json', 'w', encoding='utf-8') as f:
            json.dump(settings_data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/load-session', methods=['POST'])
def load_session():
    try:
        request_data = request.get_json()
        session_path = request_data.get('sessionPath')
        
        if not session_path or not os.path.exists(session_path):
            return jsonify({"error": "Session file not found"}), 404
            
        with open(session_path, 'r', encoding='utf-8') as f:
            session_data = json.load(f)
        return jsonify(session_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-session', methods=['POST'])
def save_session():
    try:
        request_data = request.get_json()
        session_path = request_data.get('sessionPath')
        data = request_data.get('data')
        
        # Create directory if it doesn't exist
        directory = os.path.dirname(session_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory)
        
        with open(session_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-profile', methods=['POST'])
def save_profile():
    try:
        request_data = request.get_json()
        profile_path = request_data.get('path')
        profile_data = request_data.get('data')
        
        # Create Profiles directory if it doesn't exist
        directory = os.path.dirname(profile_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory)
        
        with open(profile_path, 'w', encoding='utf-8') as f:
            json.dump(profile_data, f, ensure_ascii=False, indent=2)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/rename-profile-file', methods=['POST'])
def rename_profile_file():
    try:
        request_data = request.get_json()
        old_path = request_data.get('oldPath')
        new_path = request_data.get('newPath')
        
        if os.path.exists(old_path):
            # Create directory if needed
            directory = os.path.dirname(new_path)
            if directory and not os.path.exists(directory):
                os.makedirs(directory)
            os.rename(old_path, new_path)
            return jsonify({"status": "success"})
        else:
            return jsonify({"error": "Old file not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-json-session', methods=['POST'])
def save_json_session():
    try:
        request_data = request.get_json()
        session_path = request_data.get('sessionPath')
        data = request_data.get('data')
        file_name = request_data.get('fileName', 'imported.json')
        
        # Create directory if it doesn't exist
        directory = os.path.dirname(session_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory)
        
        # Save the JSON data to the specified path
        with open(session_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return jsonify({"status": "success", "message": f"JSON session saved to {session_path}"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/save-image', methods=['POST'])
def save_image():
    try:
        import base64
        from werkzeug.utils import secure_filename
        
        request_data = request.get_json()
        image_data = request_data.get('imageData')  # base64 encoded
        suggested_name = request_data.get('suggestedName', 'image')
        
        # Create IMG directory if it doesn't exist
        img_dir = './IMG'
        if not os.path.exists(img_dir):
            os.makedirs(img_dir)
        
        # Extract file extension from base64 header
        if ',' in image_data:
            header, data = image_data.split(',', 1)
            # Extract file type from header like "data:image/jpeg;base64"
            if 'jpeg' in header or 'jpg' in header:
                ext = '.jpg'
            elif 'png' in header:
                ext = '.png'
            elif 'gif' in header:
                ext = '.gif'
            elif 'webp' in header:
                ext = '.webp'
            else:
                ext = '.jpg'  # default
        else:
            data = image_data
            ext = '.jpg'  # default
        
        # Clean the suggested name
        clean_name = secure_filename(suggested_name.replace('/', '_').replace('\\', '_'))
        base_filename = clean_name + ext
        
        # Find available filename
        counter = 1
        filename = base_filename
        while os.path.exists(os.path.join(img_dir, filename)):
            name_part = clean_name + f"_{counter}"
            filename = name_part + ext
            counter += 1
        
        # Save the image
        file_path = os.path.join(img_dir, filename).replace('\\', '/')
        with open(file_path, 'wb') as f:
            f.write(base64.b64decode(data))
        
        return jsonify({
            "status": "success", 
            "path": file_path.replace('\\', '/'),
            "filename": filename
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/IMG/<filename>')
def serve_image(filename):
    try:
        img_dir = os.path.abspath('./IMG')
        return send_from_directory(img_dir, filename)
    except FileNotFoundError:
        return jsonify({"error": "Image not found"}), 404

@app.route('/fetch-changelog', methods=['GET'])
def fetch_changelog():
    try:
        # GitHub API URL for releases
        api_url = "https://api.github.com/repos/Ventexx/Stashhub/releases"
        
        # Load existing changelog data if it exists
        changelog_file = './changelog.json'
        existing_data = []
        last_published_date = None
        
        if os.path.exists(changelog_file):
            with open(changelog_file, 'r', encoding='utf-8') as f:
                existing_data = json.load(f)
                if existing_data:
                    # Get the most recent release date
                    last_published_date = existing_data[0].get('published_at')
        
        # Fetch from GitHub API
        response = requests.get(api_url)
        if response.status_code == 200:
            releases_data = response.json()
            
            # Check for new releases
            new_release_detected = False
            if releases_data and existing_data:
                latest_release_date = releases_data[0].get('published_at')
                if latest_release_date != last_published_date:
                    new_release_detected = True
            elif releases_data and not existing_data:
                new_release_detected = True
            
            # Save the new data
            with open(changelog_file, 'w', encoding='utf-8') as f:
                json.dump(releases_data, f, ensure_ascii=False, indent=2)
            
            return jsonify({
                "status": "success",
                "data": releases_data,
                "new_release": new_release_detected
            })
        else:
            # Return existing data if API call fails
            return jsonify({
                "status": "success",
                "data": existing_data,
                "new_release": False
            })
            
    except Exception as e:
        # Return existing data if error occurs
        try:
            if os.path.exists('./changelog.json'):
                with open('./changelog.json', 'r', encoding='utf-8') as f:
                    existing_data = json.load(f)
                return jsonify({
                    "status": "success", 
                    "data": existing_data,
                    "new_release": False
                })
        except:
            pass
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8780, debug=True)