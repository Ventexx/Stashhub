from flask import Flask, render_template, request, jsonify
import json
import os

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

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8780, debug=True)