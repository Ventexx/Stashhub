#!/bin/bash
set -e

# --- Configuration ---
REPO="Ventexx/Stashhub"
API="https://api.github.com/repos/$REPO/releases/latest"
ZIP_URL="https://github.com/$REPO/archive/refs/tags"
TMP_DIR="/tmp/stashhub_update"

# --- Check for global_settings.json ---
if [ ! -f global_settings.json ]; then
    echo "[ERROR] global_settings.json not found."
    echo "Run the app once before trying to update."
    exit 1
fi

# --- Extract current version ---
CURRENT_VERSION=$(grep -oP '"appVersion"\s*:\s*"\K[^"]+' global_settings.json)
echo "Current version: $CURRENT_VERSION"

# --- Get latest release info ---
RELEASE_INFO=$(curl -s "$API")
LATEST_NAME=$(echo "$RELEASE_INFO" | grep -oP '"name":\s*"\K[^"]+')
LATEST_TAG=$(echo "$RELEASE_INFO" | grep -oP '"tag_name":\s*"\K[^"]+')

echo "Latest release: $LATEST_NAME"
echo "Latest tag: $LATEST_TAG"

# --- Compare versions (exact match) ---
if [ "$CURRENT_VERSION" = "$LATEST_NAME" ] || [ "$CURRENT_VERSION" = "$LATEST_TAG" ]; then
    echo "Already up to date."
    exit 0
fi

if echo "$CURRENT_VERSION" | grep -qi "dev"; then
    echo "Running development build. No update performed."
    exit 0
fi

echo "Update available. Fetching new release..."

# --- Create backup ---
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
echo "Creating backup in $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"
cp -r IMG/ Profiles/ global_settings.json changelog.json "$BACKUP_DIR/" 2>/dev/null || true

# --- Download and extract ---
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

if ! curl -L "$ZIP_URL/$LATEST_TAG.zip" -o "$TMP_DIR/latest.zip"; then
    echo "[ERROR] Failed to download release zip."
    exit 1
fi

unzip -q "$TMP_DIR/latest.zip" -d "$TMP_DIR"

# --- Find the extracted directory (handle different naming patterns) ---
SRC_DIR=$(find "$TMP_DIR" -maxdepth 1 -type d -name "Stashhub-*" | head -1)
if [ -z "$SRC_DIR" ]; then
    echo "[ERROR] Could not find extracted Stashhub directory."
    exit 1
fi

echo "Found source directory: $SRC_DIR"

# --- Update application files (preserve user data) ---
echo "Updating application files..."

# Copy core application files
rsync -av --exclude 'global_settings.json' \
          --exclude 'changelog.json' \
          --exclude 'update.bat' \
          --exclude 'update.sh' \
          --exclude 'IMG/' \
          --exclude 'Profiles/' \
          "$SRC_DIR"/ ./

# --- Restore user data ---
echo "Restoring user data..."
if [ -d "$BACKUP_DIR/IMG" ]; then
    cp -r "$BACKUP_DIR/IMG" ./
fi
if [ -d "$BACKUP_DIR/Profiles" ]; then
    cp -r "$BACKUP_DIR/Profiles" ./
fi
if [ -f "$BACKUP_DIR/global_settings.json" ]; then
    cp "$BACKUP_DIR/global_settings.json" ./
fi

# --- Update version in global_settings.json ---
if [ -f global_settings.json ]; then
    # Update appVersion field
    sed -i "s/\"appVersion\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"appVersion\": \"$LATEST_NAME\"/" global_settings.json
fi

# --- Cleanup ---
rm -rf "$TMP_DIR"
echo "Backup created in: $BACKUP_DIR"

echo "Update complete. Updated from $CURRENT_VER to $LATEST_VER."
echo "If anything went wrong, restore from the backup directory."