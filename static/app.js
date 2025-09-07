const MAX_NOTIFICATIONS = 5;
let currentPath = [];
let currentSort = 'name-asc';
let data = { name: "Root", cover: "", folders: [], entries: [] };
let dataLoaded = false;
let globalSettings = {
    activeSession: "profile1",
    profiles: [
        { name: "profile1", value: "./data.json" }
    ]
};
let historyIndex = -1;
let navigationHistory = [];
let notificationContainer = null;
let saveTimeout = null;
let selectedItems = new Set();
let selectionMode = false;
let searchTimeout = null;
let isSearchActive = false;
let searchResults = null;
let searchHistory = [];
let searchExpanded = false;
let changelogData = null;

const APP_VERSION = "V1.1";


document.addEventListener('DOMContentLoaded', async function() {
    // Initialize global settings and load current session
    await loadDataFromServer();
    initializeNavigationHistory();
    initializeGlobalKeyboardShortcuts();
    
    // Check if we should show welcome modal
    if (globalSettings.showWelcomeOnStartup) {
        globalSettings.showWelcomeOnStartup = false;
        await saveGlobalSettings();
        setTimeout(() => showWelcomeModal(), 500); // Small delay for smoother experience
    }

    fetchChangelogOnStartup();
    
    document.getElementById('new-folder-btn').onclick = showCreateFolderModal;
    document.getElementById('new-entry-btn').onclick = showCreateEntryModal;

    document.getElementById('selection-toggle-btn').onclick = toggleSelectionMode;
    document.getElementById('help-btn').onclick = showHelpModal;
    document.getElementById('settings-btn').onclick = showSettingsModal;

    document.getElementById('export-btn').onclick = () => {
        try {
            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bookmarks.json';
            a.click();
            URL.revokeObjectURL(url);
            showErrorMessage('Data exported successfully!', 1);
        } catch (error) {
            showErrorMessage('Failed to export data', 3);
            console.error('Export error:', error);
        }
    };

    document.getElementById('import-btn').onclick = () => {
        document.getElementById('import-file').click();
    };

    document.getElementById('import-file').onchange = function() {
        const file = this.files[0];
        if (file) {
            if (file.type !== 'application/json') {
                showErrorMessage('Please select a valid JSON file', 2);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importedData = JSON.parse(e.target.result);
                    
                    // Basic validation
                    if (!importedData || typeof importedData !== 'object') {
                        showErrorMessage('Invalid JSON structure', 2);
                        return;
                    }
                    
                    // Create a temporary file path for the imported file
                    const tempPath = `./imported_${Date.now()}_${file.name}`;
                    
                    // Show import choice modal with file path
                    showImportChoiceModal(importedData, file.name, file.path || tempPath);
                } catch (error) {
                    showErrorMessage('Invalid JSON file format', 2);
                    console.error('Import error:', error);
                }
            };
            reader.onerror = function() {
                showErrorMessage('Failed to read file', 3);
            };
            reader.readAsText(file);
        }
    };
    
    // Initialize search functionality
    initializeSearchFunctionality();

    // Sort dropdown handler
    document.getElementById('sort-dropdown').onchange = function(e) {
        currentSort = e.target.value;
        if (isSearchActive && searchResults) {
            // Re-sort search results
            refreshSearchResults();
        } else {
            render();
        }
    };

    // Initial render
    render();
});

// =-=-=-=-=-=-=-=-=-=-=-=-=-
// CORE DATA & INITIALIZATION
// =-=-=-=-=-=-=-=-=-=-=-=-=-
function getCurrentFolder() {
    let folder = data;
    for (let idx of currentPath) {
        folder = folder.folders[idx];
    }
    return folder;
}

function getTotalEntries(folder) {
    let count = 0;

    // Count direct entries
    if (folder.entries && Array.isArray(folder.entries)) {
        count += folder.entries.length;
    }

    // Count entries in subfolders recursively
    if (folder.folders && Array.isArray(folder.folders)) {
        folder.folders.forEach(subfolder => {
            count += getTotalEntries(subfolder);
        });
    }

    return count;
}

function getLinksCount(entry) {
    if (!entry.links || !Array.isArray(entry.links)) {
        return 0;
    }
    return entry.links.filter(link => link && link.trim()).length;
}

function deepCloneItem(item) {
    return JSON.parse(JSON.stringify(item));
}

function collectAllLinksFromFolder(folder, linkArray) {
    // Collect links from direct entries
    if (folder.entries) {
        folder.entries.forEach(entry => {
            if (entry.links) {
                entry.links.forEach(link => {
                    if (link && link.trim() && isValidLinkUrl(link.trim())) {
                        linkArray.push(link.trim());
                    }
                });
            }
        });
    }
    
    // Recursively collect from subfolders
    if (folder.folders) {
        folder.folders.forEach(subfolder => {
            collectAllLinksFromFolder(subfolder, linkArray);
        });
    }
}

function getPathDisplayString(path) {
    if (path.length === 0) return 'Root';
    
    let pathString = 'Root';
    let folder = data;
    
    for (let i = 0; i < path.length; i++) {
        folder = folder.folders[path[i]];
        pathString += ' / ' + folder.name;
    }
    
    return pathString;
}

function extractDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'Unknown';
    }
}

function initNotificationContainer() {
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.className = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
}

async function createDefaultGlobalSettings() {
    globalSettings = {
        activeSession: "profile1",
        profiles: [
            { name: "profile1", value: "./data.json" }
        ],
        showWelcomeOnStartup: true,
        appVersion: APP_VERSION
    };
    await saveGlobalSettings();
}

async function initializeGlobalSettings() {
    try {
        const response = await fetch('/load-global-settings');
        if (response.ok) {
            const serverGlobalSettings = await response.json();
            globalSettings = serverGlobalSettings;
            
            // Check and update app version
            if (!globalSettings.appVersion || globalSettings.appVersion !== APP_VERSION) {
                const oldVersion = globalSettings.appVersion || "Unknown";
                globalSettings.appVersion = APP_VERSION;
                await saveGlobalSettings();
                
                // Optionally show a notification about version update
                if (oldVersion !== "Unknown") {
                    console.log(`App updated from ${oldVersion} to ${APP_VERSION}`);
                    // You could show a notification here if desired
                }
            }
            
            // Ensure showWelcomeOnStartup exists (for backward compatibility)
            if (globalSettings.showWelcomeOnStartup === undefined) {
                globalSettings.showWelcomeOnStartup = false;
                await saveGlobalSettings();
            }
        } else {
            // Create default global settings file
            await createDefaultGlobalSettings();
        }
    } catch (error) {
        console.log('Creating default global settings file');
        await createDefaultGlobalSettings();
    }
}

function initializeGlobalKeyboardShortcuts() {
    let lastSlotKeyPress = { slot: null, timestamp: 0 };
    
    document.addEventListener('keydown', (e) => {
        // Only trigger if user is not typing in an input field or modal is open
        if (e.target.tagName === 'INPUT' || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.tagName === 'SELECT' ||
            document.querySelector('.modal-overlay')) {
            return;
        }
        
        // "/" key to focus search bar
        if (e.key === '/') {
            e.preventDefault();
            const searchToggleBtn = document.getElementById('search-toggle-btn');
            const searchInput = document.getElementById('search-input');
            
            if (!searchExpanded) {
                handleSearchToggle();
            } else {
                searchInput.focus();
            }
        }
        
        // Path slot shortcuts
        if (e.key >= '1' && e.key <= '3' && e.altKey && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            const slotNumber = parseInt(e.key);
            const currentTime = Date.now();
            
            // Check if this is a double-press within 1 second
            if (lastSlotKeyPress.slot === slotNumber && 
                currentTime - lastSlotKeyPress.timestamp < 1000) {
                // Double-press detected - save current path
                savePathToSlot(slotNumber);
                lastSlotKeyPress = { slot: null, timestamp: 0 }; // Reset
            } else {
                // Single press - try to load path, or record for potential double-press
                const savedPath = data.settings?.pathSlots?.[slotNumber];
                
                if (savedPath && Array.isArray(savedPath)) {
                    // Slot has a path - load it
                    loadPathFromSlot(slotNumber);
                    lastSlotKeyPress = { slot: null, timestamp: 0 }; // Reset
                } else {
                    // Slot is empty - record this press for potential double-press
                    lastSlotKeyPress = { slot: slotNumber, timestamp: currentTime };
                    showErrorMessage(`Slot ${slotNumber} is empty. Press Alt+${slotNumber} again within 1 second to save current path`, 1);
                }
            }
        }
    });
}

// =-=-=-=-=-=-=-=-=-=-=-=-
// SETTINGS & CONFIGURATION
// =-=-=-=-=-=-=-=-=-=-=-=-
function initializeSettings() {
    if (!data.settings) {
        data.settings = {
            defaultFolderAspectRatio: '8:3',
            defaultFolderColor: '#28a745',
            defaultEntryAspectRatio: '8:3',
            defaultEntryColor: '#6c757d',
            defaultFolderWhiteText: false,
            linksExpandedByDefault: true,
            noteExpandedByDefault: true,
            tagsExpandedByDefault: false,
            entryClickAction: 'openLinks', // 'openLinks' or 'copyNote'
            coverExpandedByDefault: false,
            pathSlots: {
                1: null,
                2: null,
                3: null
            }
        };
    }
    
    // Initialize pathSlots if it doesn't exist (for existing profiles)
    if (!data.settings.pathSlots) {
        data.settings.pathSlots = {
            1: null,
            2: null,
            3: null
        };
    }
    
    // Initialize coverExpandedByDefault if it doesn't exist (for existing profiles)
    if (data.settings.coverExpandedByDefault === undefined) {
        data.settings.coverExpandedByDefault = false;
    }
}

function applyDefaultSettings(item, type) {
    initializeSettings();
    
    if (type === 'folder') {
        if (!item.aspectRatio) {
            item.aspectRatio = data.settings.defaultFolderAspectRatio;
        }
        if (!item.color) {
            item.color = data.settings.defaultFolderColor;
        }
        if (item.whiteText === undefined) {
            item.whiteText = data.settings.defaultFolderWhiteText;
        }
        if (!item.folderTags) {
            item.folderTags = [];
        }
    } else if (type === 'entry') {
        if (!item.aspectRatio) {
            item.aspectRatio = data.settings.defaultEntryAspectRatio;
        }
        if (!item.color) {
            item.color = data.settings.defaultEntryColor;
        }
        if (!item.entryTags) {
            item.entryTags = [];
        }
    }
}

function applyAspectRatio(targetType, targetIndex, aspectRatio) {
    const folder = getCurrentFolder();
    
    if (targetType === 'folder') {
        folder.folders[targetIndex].aspectRatio = aspectRatio;
    } else if (targetType === 'entry') {
        folder.entries[targetIndex].aspectRatio = aspectRatio;
    }
    
    autoSave();
    render();
}

function applyAspectRatioStyles() {
    const folders = document.querySelectorAll('.folder');
    const entries = document.querySelectorAll('.entry');
    const currentFolder = getCurrentFolder();
    
    const { folders: sortedFolders, entries: sortedEntries } = sortFoldersAndEntries(
        currentFolder.folders || [], 
        currentFolder.entries || [], 
        currentSort
    );
    
    folders.forEach((folderElement, index) => {
        const originalIdx = currentFolder.folders.findIndex(original => original === sortedFolders[index]);
        const folder = currentFolder.folders[originalIdx];
        const aspectRatio = folder?.aspectRatio || '8:3';
        const img = folderElement.querySelector('img');
        if (img) {
            setImageAspectRatio(img, aspectRatio);
        }
    });
    
    entries.forEach((entryElement, index) => {
        const originalIdx = currentFolder.entries.findIndex(original => original === sortedEntries[index]);
        const entry = currentFolder.entries[originalIdx];
        const aspectRatio = entry?.aspectRatio || '8:3';
        const img = entryElement.querySelector('img');
        if (img) {
            setImageAspectRatio(img, aspectRatio);
        }
    });
}

function applyDynamicColors() {
    const folders = document.querySelectorAll('.folder');
    const entries = document.querySelectorAll('.entry');
    
    folders.forEach((folderElement, index) => {
        const currentFolder = getCurrentFolder();
        const { folders: sortedFolders } = sortFoldersAndEntries(
            currentFolder.folders || [], 
            currentFolder.entries || [], 
            currentSort
        );
        
        // Get the original folder data using the display index
        const originalIdx = currentFolder.folders.findIndex(original => original === sortedFolders[index]);
        const folder = currentFolder.folders[originalIdx];
        const color = folder?.color || '#28a745';
        const whiteText = folder?.whiteText || false;
        
        // Create color variations for folder
        const variations = createColorVariations(color, 'folder');
        
        folderElement.style.setProperty('--folder-bg-color', variations.gradient);
        folderElement.style.setProperty('--folder-border-color', variations.border);
        
        // Apply text colors
        const folderName = folderElement.querySelector('.folder-name');
        const folderCount = folderElement.querySelector('.folder-count');
        
        if (whiteText) {
            folderName.style.color = 'white';
            folderCount.style.color = '#e0e0e0e0';
        } else {
            folderName.style.color = '#333';
            folderCount.style.color = '#474747ff';
        }
    });
    
    entries.forEach((entryElement, index) => {
        const currentFolder = getCurrentFolder();
        const { entries: sortedEntries } = sortFoldersAndEntries(
            currentFolder.folders || [], 
            currentFolder.entries || [], 
            currentSort
        );
        
        // Get the original entry data using the display index
        const originalIdx = currentFolder.entries.findIndex(original => original === sortedEntries[index]);
        const entry = currentFolder.entries[originalIdx];
        const color = entry?.color || '#6c757d';
        
        // Create color variations for entry
        const variations = createColorVariations(color, 'entry');
        
        entryElement.style.setProperty('--entry-border-color', variations.gradient);
    });
}

function adjustColorBrightness(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
}

function createColorVariations(baseColor, type = 'folder') {
    // Parse the hex color
    const num = parseInt(baseColor.replace("#", ""), 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    
    // Create variations based on type
    if (type === 'folder') {
        // For folders: create a gradient from lighter to darker
        const lighterR = Math.min(255, r + 40);
        const lighterG = Math.min(255, g + 40);
        const lighterB = Math.min(255, b + 40);
        
        const darkerR = Math.max(0, r - 40);
        const darkerG = Math.max(0, g - 40);
        const darkerB = Math.max(0, b - 40);
        
        const lighterColor = `#${((1 << 24) + (lighterR << 16) + (lighterG << 8) + lighterB).toString(16).slice(1)}`;
        const darkerColor = `#${((1 << 24) + (darkerR << 16) + (darkerG << 8) + darkerB).toString(16).slice(1)}`;
        
        return {
            gradient: `linear-gradient(135deg, ${lighterColor}, ${baseColor}, ${darkerColor})`,
            border: darkerColor
        };
    } else if (type === 'entry') {
        // For entries: create border gradient variations
        const lighterR = Math.min(255, r + 30);
        const lighterG = Math.min(255, g + 30);
        const lighterB = Math.min(255, b + 30);
        
        const darkerR = Math.max(0, r - 30);
        const darkerG = Math.max(0, g - 30);
        const darkerB = Math.max(0, b - 30);
        
        const lighterColor = `#${((1 << 24) + (lighterR << 16) + (lighterG << 8) + lighterB).toString(16).slice(1)}`;
        const darkerColor = `#${((1 << 24) + (darkerR << 16) + (darkerG << 8) + darkerB).toString(16).slice(1)}`;
        
        return {
            gradient: `linear-gradient(45deg, ${lighterColor}, ${darkerColor})`,
            border: baseColor
        };
    }
}

function setCoverImage(targetType, targetIndex, imageSource) {
    const folder = getCurrentFolder();
    
    // Check if it's a web URL and block it
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
        showErrorMessage('Web image URLs are not allowed. Please download the image and upload it locally instead.', 2);
        return;
    }
    
    let finalImageSource = imageSource;
    let messageText = '';
    
    // Handle different types of image sources
    if (imageSource.startsWith('./IMG/')) {
        // Local saved image
        finalImageSource = imageSource;
        messageText = 'Local image file saved successfully!';
    } else if (imageSource.startsWith('file://')) {
        // Direct file:// URLs (still allow these for manual entry)
        finalImageSource = imageSource;
        messageText = 'Local file path saved.';
    } else {
        // Unknown format - allow but warn
        finalImageSource = imageSource;
        messageText = 'Image source saved.';
    }
    
    let updatedItem = null;
    
    if (targetType === 'folder') {
        folder.folders[targetIndex].cover = finalImageSource;
        updatedItem = folder.folders[targetIndex];
        showErrorMessage(`Folder cover updated! ${messageText}`, 1);
    } else if (targetType === 'entry') {
        folder.entries[targetIndex].cover = finalImageSource;
        updatedItem = folder.entries[targetIndex];
        showErrorMessage(`Entry cover updated! ${messageText}`, 1);
    }
    
    autoSave();
    render();
    refreshSearchIfActive();
}

function setImageAspectRatio(img, aspectRatio) {
    const [width, height] = aspectRatio.split(':').map(Number);
    const ratio = height / width;
    
    // Set container width to 160px and calculate height to maintain aspect ratio
    const containerWidth = 160;
    const calculatedHeight = containerWidth * ratio;
    
    // Apply the exact aspect ratio
    img.style.width = `${containerWidth}px`;
    img.style.height = `${calculatedHeight}px`;
    img.style.objectFit = 'cover';
    
    // For square images (1:1), ensure it's actually square
    if (aspectRatio === '1:1') {
        img.style.width = '160px';
        img.style.height = '160px';
    }
}

async function loadGlobalSettings() {
    try {
        const response = await fetch('/load-global-settings');
        if (response.ok) {
            const serverGlobalSettings = await response.json();
            globalSettings = serverGlobalSettings;
        }
    } catch (error) {
        console.log('Using default global settings');
    }
}

async function saveGlobalSettings() {
    try {
        const response = await fetch('/save-global-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(globalSettings)
        });
        
        if (!response.ok) {
            console.error('Failed to save global settings');
        }
    } catch (error) {
        console.error('Error saving global settings:', error);
    }
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-
// SESSION & STATE MANAGEMENT
// =-=-=-=-=-=-=-=-=-=-=-=-=-
async function loadDataFromServer() {
    if (dataLoaded) return;
    await initializeGlobalSettings();
    await loadCurrentSession();
}

async function saveDataToServer() {
    try {
        const activeProfile = globalSettings.profiles.find(p => p.name === globalSettings.activeSession);
        if (!activeProfile || !activeProfile.value) {
            showErrorMessage('No active session to save to', 2);
            return;
        }
        
        const response = await fetch('/save-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionPath: activeProfile.value,
                data: data
            })
        });
        
        if (response.ok) {
            showErrorMessage('Data saved successfully!', 1);
        } else {
            showErrorMessage('Failed to save data to server', 2);
        }
    } catch (error) {
        showErrorMessage('Error saving data to server', 2);
        console.error('Save error:', error);
    }
}

function autoSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveDataToServer();
    }, 1000); // Save 1 second after last change
}

async function loadCurrentSession() {
    const activeProfile = globalSettings.profiles.find(p => p.name === globalSettings.activeSession);
    if (!activeProfile || !activeProfile.value) {
        showErrorMessage('Active profile has no JSON file assigned', 2);
        return;
    }
    
    try {
        const response = await fetch('/load-session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionPath: activeProfile.value })
        });
        
        if (response.ok) {
            const sessionData = await response.json();
            data = sessionData;
            dataLoaded = true;
            currentPath = [];
            clearSelection();
            render();
            showErrorMessage(`Loaded session: ${activeProfile.name}`, 1);
        } else {
            showErrorMessage('Failed to load session', 2);
        }
    } catch (error) {
        showErrorMessage('Error loading session', 2);
        console.error('Load session error:', error);
    }
}

async function switchToSession(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile || !profile.value) {
        showErrorMessage('Profile has no JSON file assigned', 2);
        return;
    }
    
    if (globalSettings.activeSession !== profileName) {
        // Clear any active search when switching profiles
        if (isSearchActive) {
            clearSearch();
            const searchInput = document.getElementById('search-input');
            const clearBtn = document.getElementById('search-clear-btn');
            const helpBox = document.getElementById('search-help-box');
            const toggleBtn = document.getElementById('search-toggle-btn');
            const searchBarContainer = document.getElementById('search-bar-container');
        
            if (searchInput) searchInput.value = '';
            if (clearBtn) clearBtn.style.display = 'none';
            if (helpBox) helpBox.classList.remove('visible');
        
            // Reset search UI state
            searchExpanded = false;
            if (toggleBtn) {
                toggleBtn.classList.remove('active');
                toggleBtn.style.display = 'flex';
            }
            if (searchBarContainer) {
                searchBarContainer.classList.remove('expanded');
            }
        }

        globalSettings.activeSession = profileName;
        await saveGlobalSettings();
        await loadCurrentSession();
    }
}

function assignJsonToProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile) return;
    
    // Create a file input to select JSON
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (file) {
            if (file.type !== 'application/json') {
                showErrorMessage('Please select a valid JSON file', 2);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const jsonData = JSON.parse(e.target.result);
                    
                    // Basic validation
                    if (!jsonData || typeof jsonData !== 'object') {
                        showErrorMessage('Invalid JSON structure', 2);
                        return;
                    }
                    
                    const fileName = file.name.replace('.json', '');
                    const profilePath = `./Profiles/${fileName}.json`;
                    
                    // Save JSON to profiles directory
                    const response = await fetch('/save-profile', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            path: profilePath,
                            data: jsonData
                        })
                    });
                    
                    if (response.ok) {
                        profile.value = profilePath;
                        await saveGlobalSettings();
                        renderProfilesList();
                        showErrorMessage(`JSON assigned to ${profileName}`, 1);
                    } else {
                        showErrorMessage('Failed to save JSON file', 2);
                    }
                    
                } catch (error) {
                    showErrorMessage('Invalid JSON file format', 2);
                    console.error('JSON parse error:', error);
                }
            };
            reader.readAsText(file);
        }
    });
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

function renderProfilesList() {
    const container = document.getElementById('profiles-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    globalSettings.profiles.forEach((profile, index) => {
        const isActive = globalSettings.activeSession === profile.name;
        const hasAssignedJson = profile.value && profile.value !== '';
        const profileNumber = index + 1;
        
        const profileDiv = document.createElement('div');
        profileDiv.className = 'profile-item';
        profileDiv.innerHTML = `
            <button class="profile-name-btn ${hasAssignedJson ? 'assigned' : 'unassigned'}" 
                    title="${hasAssignedJson ? profile.value : 'No JSON assigned'}">
                Profile ${profileNumber}
            </button>
            <div class="profile-actions">
                <button class="profile-set-active-btn" title="${isActive ? 'Active' : 'Set Active'}" data-profile-name="${profile.name}">
                    ${isActive ? '✅' : '⚪'}
                </button>
                <button class="profile-export-btn" title="Export JSON" data-profile-name="${profile.name}">📤</button>
                <button class="profile-rename-btn" title="Rename Profile" data-profile-name="${profile.name}">✏️</button>
                <button class="profile-assign-btn" title="Assign JSON" data-profile-name="${profile.name}">📂</button>
                <button class="profile-save-current-btn" title="Save Current to Profile" data-profile-name="${profile.name}">💾</button>
                <button class="profile-delete-btn" title="Delete Profile" data-profile-name="${profile.name}">🗑️</button>
            </div>
        `;
        
        // Update button state for active profile
        const setActiveBtn = profileDiv.querySelector('.profile-set-active-btn');
        if (isActive) {
            setActiveBtn.disabled = true;
            setActiveBtn.style.opacity = '0.6';
        }
        
        // Add event listeners
        profileDiv.querySelector('.profile-set-active-btn').onclick = () => setActiveProfile(profile.name);
        profileDiv.querySelector('.profile-export-btn').onclick = () => exportProfile(profile.name);
        profileDiv.querySelector('.profile-rename-btn').onclick = () => renameProfile(profile.name);
        profileDiv.querySelector('.profile-assign-btn').onclick = () => assignJsonToProfile(profile.name);
        profileDiv.querySelector('.profile-save-current-btn').onclick = () => saveCurrentToProfile(profile.name);
        profileDiv.querySelector('.profile-delete-btn').onclick = () => deleteProfile(profile.name);
        
        container.appendChild(profileDiv);
    });
}

function createNewProfile() {
    let nextNumber = 1;
    while (globalSettings.profiles.some(p => p.name === `profile${nextNumber}`)) {
        nextNumber++;
    }
    
    const newProfile = {
        name: `profile${nextNumber}`,
        value: ""
    };
    
    globalSettings.profiles.push(newProfile);
    saveGlobalSettings();
    renderProfilesList();
    showErrorMessage(`New profile${nextNumber} created!`, 1);
}

async function setActiveProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile) return;
    
    if (!profile.value) {
        showCreateJsonModal(profileName, async () => {
            // Create new JSON for this profile
            const profilePath = `./Profiles/${profileName}.json`;
            const emptyJsonData = createEmptyJsonData();
            
            try {
                const response = await fetch('/save-profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        path: profilePath,
                        data: emptyJsonData
                    })
                });
                
                if (response.ok) {
                    profile.value = profilePath;
                    await saveGlobalSettings();
                    renderProfilesList();
                    showErrorMessage(`New JSON created for ${profileName}!`, 1);
                } else {
                    showErrorMessage('Failed to create JSON file', 2);
                }
            } catch (error) {
                showErrorMessage('Error creating JSON file', 2);
                console.error('Create JSON error:', error);
            }
        });
        return;
    }
    
    if (globalSettings.activeSession === profileName) {
        showErrorMessage('This profile is already active', 1);
        return;
    }
    
    await switchToSession(profileName);
    renderProfilesList();
}

function exportProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile || !profile.value) {
        showErrorMessage('Cannot export: No JSON assigned to this profile', 2);
        return;
    }
    
    try {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${profile.name}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showErrorMessage(`Profile ${profile.name} exported successfully!`, 1);
    } catch (error) {
        showErrorMessage('Failed to export profile', 2);
        console.error('Export error:', error);
    }
}

async function renameProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile) return;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay rename-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Rename Profile</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Profile Name:</label>
                    <input type="text" id="profile-name-input" value="${profile.name}" placeholder="Enter profile name">
                </div>
                <div class="modal-actions">
                    <button id="save-name-btn" type="button" class="btn-primary">💾 Save Name</button>
                    <button id="cancel-name-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#cancel-name-btn').onclick = () => modal.remove();
    
    modal.querySelector('#save-name-btn').onclick = async () => {
        const newName = modal.querySelector('#profile-name-input').value.trim();
        if (!newName) {
            showErrorMessage('Profile name cannot be empty', 2);
            return;
        }
        
        if (globalSettings.profiles.some(p => p.name === newName && p !== profile)) {
            showErrorMessage('Profile name already exists', 2);
            return;
        }
        
        const oldName = profile.name;
        const isActive = globalSettings.activeSession === oldName;
        
        // If profile has JSON assigned, rename the actual file
        if (profile.value) {
            const oldPath = profile.value;
            const newPath = `./Profiles/${newName}.json`;
            
            try {
                const response = await fetch('/rename-profile-file', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        oldPath: oldPath,
                        newPath: newPath
                    })
                });
                
                if (response.ok) {
                    profile.value = newPath;
                } else {
                    showErrorMessage('Failed to rename profile file', 2);
                    return;
                }
            } catch (error) {
                showErrorMessage('Error renaming profile file', 2);
                return;
            }
        }
        
        profile.name = newName;
        if (isActive) {
            globalSettings.activeSession = newName;
        }
        
        await saveGlobalSettings();
        renderProfilesList();
        modal.remove();
        showErrorMessage('Profile renamed successfully!', 1);
    };
    
    setupModalEscapeKey(modal);
}

async function saveCurrentToProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile) return;
    
    // Set profile path
    const profilePath = `./Profiles/${profileName}.json`;
    profile.value = profilePath;
    
    // Save current data to profile
    try {
        const response = await fetch('/save-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                path: profilePath,
                data: data
            })
        });
        
        if (response.ok) {
            await saveGlobalSettings();
            renderProfilesList();
            showErrorMessage(`Current data saved to ${profileName}`, 1);
        } else {
            showErrorMessage('Failed to save data to profile', 2);
        }
    } catch (error) {
        showErrorMessage('Error saving data to profile', 2);
        console.error('Save profile error:', error);
    }
}

async function deleteProfile(profileName) {
    const profile = globalSettings.profiles.find(p => p.name === profileName);
    if (!profile) return;
    
    // Prevent deleting if only one profile exists
    if (globalSettings.profiles.length <= 1) {
        showErrorMessage('Cannot delete the only remaining profile', 2);
        return;
    }
    
    showDeleteProfileModal(profileName, async () => {
        // If this is the active profile, switch to another one
        if (globalSettings.activeSession === profileName) {
            const remainingProfile = globalSettings.profiles.find(p => p.name !== profileName);
            globalSettings.activeSession = remainingProfile ? remainingProfile.name : "profile1";
        }
        
        // Remove profile from array
        const profileIndex = globalSettings.profiles.findIndex(p => p.name === profileName);
        if (profileIndex > -1) {
            globalSettings.profiles.splice(profileIndex, 1);
        }
        
        await saveGlobalSettings();
        renderProfilesList();
        showErrorMessage(`${profileName} deleted successfully`, 1);
    });
}

// =-=-=-=-=-=-=-=-=-=-=-=
// UI RENDERING & HANDLING
// =-=-=-=-=-=-=-=-=-=-=-=
function render() {
    const mainView = document.getElementById('main-view');
    const folder = getCurrentFolder();
    mainView.innerHTML = '';

    // Create and append PathBar
    const pathBar = createPathBar();
    mainView.appendChild(pathBar);

    // Create content container with proper padding
    const contentWrapper = document.createElement('div');
    contentWrapper.style.padding = '20px';
    
    // Batch actions bar
    const batchBar = createBatchActionsBar();
    contentWrapper.appendChild(batchBar);

    // Create content container for drag and drop
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-container';
    setupMainAreaDragDrop(contentDiv);

    // Get sorted folders and entries
    const { folders: sortedFolders, entries: sortedEntries } = sortFoldersAndEntries(
        folder.folders || [], 
        folder.entries || [], 
        currentSort
    );

    // Render subfolders
    sortedFolders.forEach((f, displayIdx) => {
        // Find original index for operations
        const originalIdx = folder.folders.findIndex(original => original === f);
        
        const div = document.createElement('div');
        div.className = 'folder';
        if (selectionMode) div.classList.add('selection-mode');
        if (selectedItems.has(`folder:${originalIdx}`)) div.classList.add('selected');
        
        const totalEntries = getTotalEntries(f);
        
        div.innerHTML = `
            ${selectionMode ? `<input type="checkbox" class="selection-checkbox" ${selectedItems.has(`folder:${originalIdx}`) ? 'checked' : ''}>` : ''}
            <img src="${f.cover || '/static/images/folder.png'}" alt="Cover" title="${f.cover ? 'Folder cover image' : 'Default folder icon'}" onerror="this.src='/static/images/folder.png'">
            <div class="folder-name">📁 ${f.name}</div>
            <div class="folder-count">${totalEntries} entries</div>
        `;
        
        if (selectionMode) {
            const checkbox = div.querySelector('.selection-checkbox');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleSelection(`folder:${originalIdx}`, div);
            };
        }
        
        div.onclick = (e) => {
            if (e.defaultPrevented) return;
            if (selectionMode) {
                toggleSelection(`folder:${originalIdx}`, div);
            } else {
                navigateToFolder(originalIdx);
            }
        };
        
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFolderEditModal(f, originalIdx);
        });
        
        setupFolderDragDrop(div, originalIdx);
        contentDiv.appendChild(div);
    });

    // Render entries
    sortedEntries.forEach((e, displayIdx) => {
        // Find original index for operations
        const originalIdx = folder.entries.findIndex(original => original === e);
        
        const div = document.createElement('div');
        div.className = 'entry';
        if (selectionMode) div.classList.add('selection-mode');
        if (selectedItems.has(`entry:${originalIdx}`)) div.classList.add('selected');
        
        div.innerHTML = `
            ${selectionMode ? `<input type="checkbox" class="selection-checkbox" ${selectedItems.has(`entry:${originalIdx}`) ? 'checked' : ''}>` : ''}
            <img src="${e.cover || '/static/images/entry.png'}" alt="Cover" title="${e.cover ? 'Entry cover image' : 'Default entry icon'}" onerror="this.src='/static/images/entry.png'">
            <div class="entry-title">${e.name}</div>
            <div class="entry-links-count">${getLinksCount(e)} links</div>
        `;
        
        if (selectionMode) {
            const checkbox = div.querySelector('.selection-checkbox');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleSelection(`entry:${originalIdx}`, div);
            };
        }
        
        div.onclick = (e) => {
            if (e.defaultPrevented) return;
            if (selectionMode) {
                toggleSelection(`entry:${originalIdx}`, div);
            } else {
                // Open-ended functionality for future implementation
                handleEntryClick(e, originalIdx);
            }
        };
        
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showEntryEditModal(e, originalIdx);
        });
        
        setupEntryDragDrop(div, originalIdx);
        contentDiv.appendChild(div);
    });

    contentWrapper.appendChild(contentDiv);

    // Show empty message if no content
    if (folder.folders.length === 0 && folder.entries.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = 'This folder is empty. Create a new folder or entry, or drag and drop content here!';
        contentDiv.appendChild(emptyDiv);
    }

    mainView.appendChild(contentWrapper);

    // Apply dynamic colors after creating elements
    setTimeout(() => {
        applyAspectRatioStyles();
        applyDynamicColors();
    }, 0);

    updateBatchActionsBar();
}

function createPathBar() {
    const pathBar = document.createElement('div');
    pathBar.className = 'path-bar';

    // Left side - Path container
    const pathBarLeft = document.createElement('div');
    pathBarLeft.className = 'path-bar-left';

    const pathContainer = document.createElement('div');
    pathContainer.className = 'path-container';

    const pathLabel = document.createElement('div');
    pathLabel.className = 'path-label';
    pathLabel.textContent = 'Path';
    pathContainer.appendChild(pathLabel);

    // Main separator
    const mainSeparator = document.createElement('div');
    mainSeparator.className = 'path-separator-main';
    pathContainer.appendChild(mainSeparator);

    // Path buttons container
    const pathButtons = document.createElement('div');
    pathButtons.className = 'path-buttons';

    // Build path elements
    const pathElements = ['Root'];
    for (let i = 0; i < currentPath.length; i++) {
        let f = data;
        for (let j = 0; j <= i; j++) {
            f = f.folders[currentPath[j]];
        }
        pathElements.push(f.name);
    }

    // Create path buttons
    pathElements.forEach((name, index) => {
        const isLast = index === pathElements.length - 1;
        const isCurrent = isLast;

        // Create path button
        const pathButton = document.createElement('button');
        pathButton.className = 'path-button';
        pathButton.textContent = name;

        if (isCurrent) {
            pathButton.classList.add('current');
        } else {
            pathButton.addEventListener('click', () => {
                const targetIndex = index - 1;
                if (targetIndex === -1) {
                    // Navigate to root
                    clearSearch();
                    navigateToPath([]);
                } else {
                    // Navigate to specific folder
                    navigateToPath(currentPath.slice(0, targetIndex + 1));
                }
            });
        }

        pathButtons.appendChild(pathButton);

        // Add separator if not last
        if (!isLast) {
            const separator = document.createElement('span');
            separator.className = 'path-separator';
            separator.textContent = '/';
            pathButtons.appendChild(separator);
        }
    });

    pathContainer.appendChild(pathButtons);
    pathBarLeft.appendChild(pathContainer);

    // Right side - Navigation buttons
    const pathBarRight = document.createElement('div');
    pathBarRight.className = 'path-bar-right';

    // Up button
    const upButton = document.createElement('button');
    upButton.className = 'nav-button';
    upButton.innerHTML = '↑';
    upButton.title = 'Go to parent folder';
    upButton.onclick = () => navigateUp();
    if (currentPath.length === 0) {
        upButton.classList.add('disabled');
    }

    // Left button
    const leftButton = document.createElement('button');
    leftButton.className = 'nav-button';
    leftButton.innerHTML = '←';
    leftButton.title = 'Go back';
    leftButton.onclick = () => navigateBack();
    if (historyIndex <= 0) {
        leftButton.classList.add('disabled');
    }

    // Right button
    const rightButton = document.createElement('button');
    rightButton.className = 'nav-button';
    rightButton.innerHTML = '→';
    rightButton.title = 'Go forward';
    rightButton.onclick = () => navigateForward();
    if (historyIndex >= navigationHistory.length - 1) {
        rightButton.classList.add('disabled');
    }

    pathBarRight.appendChild(upButton);
    pathBarRight.appendChild(leftButton);
    pathBarRight.appendChild(rightButton);

    pathBar.appendChild(pathBarLeft);
    pathBar.appendChild(pathBarRight);

    return pathBar;
}

function createBatchActionsBar() {
    const bar = document.createElement('div');
    bar.className = 'batch-actions-bar';
    bar.id = 'batch-actions-bar';
    
    bar.innerHTML = `
        <div class="batch-actions">
            <button id="batch-delete-btn" class="batch-delete-btn" data-tooltip="Delete">🗑️</button>
            <button id="batch-export-btn" class="batch-export-btn" data-tooltip="Export as JSON">📤</button>
            <button id="batch-duplicate-btn" class="batch-duplicate-btn" data-tooltip="Duplicate">📄</button>
            <button id="batch-open-btn" class="batch-open-btn" data-tooltip="Open all Links">🚀</button>
            <button id="batch-move-btn" class="batch-move-btn" data-tooltip="Move">📁</button>
        </div>
        <div class="batch-actions">
            <button id="batch-clear-btn" class="batch-clear-btn" data-tooltip="Clear Selection">✗</button>
            <button id="batch-select-all-btn" class="batch-select-all-btn" data-tooltip="Select All">✓</button>
        </div>
        <div class="batch-counter" id="batch-counter">0 items selected</div>
    `;
    
    bar.querySelector('#batch-select-all-btn').onclick = selectAllItems;
    bar.querySelector('#batch-clear-btn').onclick = clearSelection;
    bar.querySelector('#batch-move-btn').onclick = showMoveModal;
    bar.querySelector('#batch-open-btn').onclick = () => {
        if (selectedItems.size === 0) {
            showErrorMessage('No items selected to open', 1);
            return;
        }
        openAllSelectedItems();
    };
    bar.querySelector('#batch-export-btn').onclick = () => {
        if (selectedItems.size === 0) {
            showErrorMessage('No items selected to export', 1);
            return;
        }
        exportSelectedItemsAsJson();
    };
    bar.querySelector('#batch-duplicate-btn').onclick = () => {
        if (selectedItems.size === 0) {
            showErrorMessage('No items selected to duplicate', 1);
            return;
        }
        duplicateSelectedItems();
    };
    bar.querySelector('#batch-delete-btn').onclick = () => {
        if (selectedItems.size === 0) {
            showErrorMessage('No items selected to delete', 1);
            return;
        }
        deleteSelectedItemsWithConfirmation();
    };
    
    return bar;
}

function setupMainAreaDragDrop(contentDiv) {
    let dragCounter = 0;

    contentDiv.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        contentDiv.classList.add('drag-over');
    });

    contentDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    contentDiv.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            contentDiv.classList.remove('drag-over');
        }
    });

    contentDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        contentDiv.classList.remove('drag-over');

        const files = Array.from(e.dataTransfer.files);
        const urls = e.dataTransfer.getData('text/uri-list').split('\n').filter(url => url.trim());
        const textData = e.dataTransfer.getData('text/plain');

        // Handle JSON files first
        const jsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length > 0) {
            handleJsonDrop(jsonFiles[0]);
            return; // Exit early, don't process other file types
        }

        // Handle image files
        const imageFiles = files.filter(file => isImageFile(file));
        imageFiles.forEach(async file => {
            const fileName = file.name.replace(/\.[^/.]+$/, "");
            const newEntryName = fileName; // Use original filename as-is
    
            // Convert to base64 and save
            const reader = new FileReader();
            reader.onload = async function(e) {
                const base64Data = e.target.result;
        
                try {
                    const response = await fetch('/save-image', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            imageData: base64Data,
                            suggestedName: fileName
                        })
                    });
            
                    if (response.ok) {
                        const result = await response.json();
                        createNewEntry(newEntryName, result.path, []); // Set cover as second parameter
                        showErrorMessage(`Image saved and entry created: "${result.filename}"`, 1);
                    } else {
                        createNewEntry(newEntryName, '', []);
                        showErrorMessage('Failed to save image. Entry created without cover.', 2);
                    }
                } catch (error) {
                    createNewEntry(newEntryName, '', []);
                    showErrorMessage('Error processing image. Entry created without cover.', 2);
                }
            };
            reader.readAsDataURL(file);
        });

        // Handle URLs
        if (urls.length > 0) {
            urls.forEach(url => {
                if (url.trim()) {
                    if (isImageUrl(url)) {
                        showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
                    } else {
                        createNewEntry(`Link from ${extractDomainFromUrl(url)}`, '', [url]);
                    }
                }
            });
        } else if (textData && isUrl(textData)) {
            if (isImageUrl(textData)) {
                showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
            } else {
                createNewEntry(`Link from ${extractDomainFromUrl(textData)}`, '', [textData]);
            }
        }
    });
}

function setupFolderDragDrop(folderDiv, folderIdx) {
    let dragCounter = 0;

    folderDiv.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
    
        // Determine drag text based on content type
        const files = Array.from(e.dataTransfer.files);
        const urls = e.dataTransfer.getData('text/uri-list').split('\n').filter(url => url.trim());
        const textData = e.dataTransfer.getData('text/plain');
    
        const imageFiles = files.filter(file => isImageFile(file));
        const hasImageUrls = urls.some(url => isImageUrl(url)) || (textData && isImageUrl(textData));
    
        let dragText = "Add to folder";
        if (imageFiles.length > 0 || hasImageUrls) {
            dragText = "Set as cover image";
        }
    
        folderDiv.style.setProperty('--drag-text', `"${dragText}"`);
        folderDiv.classList.add('folder-drag-over');
    });

    folderDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    folderDiv.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            folderDiv.classList.remove('folder-drag-over');
            folderDiv.style.removeProperty('--drag-text');
        }
    });

    folderDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        folderDiv.classList.remove('folder-drag-over');
        folderDiv.style.removeProperty('--drag-text');

        const files = Array.from(e.dataTransfer.files);
        const urls = e.dataTransfer.getData('text/uri-list').split('\n').filter(url => url.trim());
        const textData = e.dataTransfer.getData('text/plain');

        // Ignore JSON files on folders
        const jsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length > 0) {
            return;
        }

        // Handle image files - save and set as folder cover
        const imageFiles = files.filter(file => isImageFile(file));
        if (imageFiles.length > 0) {
            const file = imageFiles[0];
            const folder = getCurrentFolder();
            const folderName = folder.folders[folderIdx].name || 'folder';
    
            // Convert to base64 and save
            const reader = new FileReader();
            reader.onload = async function(e) {
                const base64Data = e.target.result;
        
                try {
                    const response = await fetch('/save-image', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            imageData: base64Data,
                            suggestedName: folderName
                        })
                    });
            
                    if (response.ok) {
                        const result = await response.json();
                        setCoverImage('folder', folderIdx, result.path);
                    } else {
                        showErrorMessage('Failed to save dropped image', 2);
                    }
                } catch (error) {
                    showErrorMessage('Error processing dropped image', 2);
                }
            };
            reader.readAsDataURL(file);
        }
        else if (urls.length > 0 && urls.some(url => isImageUrl(url))) {
            showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
        }
        else if (textData && isImageUrl(textData)) {
            showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
        }
        // Handle regular links - create new entry in folder
        else if (urls.length > 0) {
            urls.forEach(urlString => {
                if (urlString.trim() && !isImageUrl(urlString)) {
                    const extractedUrls = extractMultipleUrls(urlString);
                    if (extractedUrls.length > 0) {
                        extractedUrls.forEach(url => createEntryInFolder(folderIdx, url));
                    } else if (isValidUrl(urlString)) {
                        createEntryInFolder(folderIdx, urlString);
                    }
                }
            });
        }
        else if (textData && isUrl(textData) && !isImageUrl(textData)) {
            const extractedUrls = extractMultipleUrls(textData);
            if (extractedUrls.length > 0) {
                extractedUrls.forEach(url => createEntryInFolder(folderIdx, url));
            } else if (isValidUrl(textData)) {
                createEntryInFolder(folderIdx, textData);
            }
        }

        // Prevent folder navigation after drop
        setTimeout(() => {
            folderDiv.onclick = (e) => e.preventDefault();
            setTimeout(() => {
                folderDiv.onclick = (e) => {
                    if (e.defaultPrevented) return;
                    if (selectionMode) {
                        toggleSelection(`folder:${folderIdx}`, folderDiv);
                    } else {
                        currentPath.push(folderIdx);
                        render();
                    }
                };
            }, 100);
        }, 0);
    });
}

function setupEntryDragDrop(entryDiv, entryIdx) {
    let dragCounter = 0;

    entryDiv.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
    
        // Determine drag text based on content type
        const files = Array.from(e.dataTransfer.files);
        const urls = e.dataTransfer.getData('text/uri-list').split('\n').filter(url => url.trim());
        const textData = e.dataTransfer.getData('text/plain');

        const imageFiles = files.filter(file => isImageFile(file));
        const hasImageUrls = urls.some(url => isImageUrl(url)) || (textData && isImageUrl(textData));

        let dragText = "Add to entry";
        if (imageFiles.length > 0 || hasImageUrls) {
            dragText = "Image functionality coming soon";
        }
    
        entryDiv.style.setProperty('--drag-text', `"${dragText}"`);
        entryDiv.classList.add('entry-drag-over');
    });

    entryDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    entryDiv.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) {
            entryDiv.classList.remove('entry-drag-over');
            entryDiv.style.removeProperty('--drag-text');
        }
    });

    entryDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        entryDiv.classList.remove('entry-drag-over');
        entryDiv.style.removeProperty('--drag-text');

        const files = Array.from(e.dataTransfer.files);
        const urls = e.dataTransfer.getData('text/uri-list').split('\n').filter(url => url.trim());
        const textData = e.dataTransfer.getData('text/plain');

        // Ignore JSON files on entries
        const jsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json'));
        if (jsonFiles.length > 0) {
            return;
        }

        // Handle image files - save and set as cover
        const imageFiles = files.filter(file => isImageFile(file));
        if (imageFiles.length > 0) {
            const file = imageFiles[0];
            const folder = getCurrentFolder();
            const entryName = folder.entries[entryIdx].name || 'entry';
    
            // Convert to base64 and save
            const reader = new FileReader();
            reader.onload = async function(e) {
                const base64Data = e.target.result;
        
                try {
                    const response = await fetch('/save-image', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            imageData: base64Data,
                            suggestedName: entryName
                        })
                    });
            
                    if (response.ok) {
                        const result = await response.json();
                        setCoverImage('entry', entryIdx, result.path);
                    } else {
                        showErrorMessage('Failed to save dropped image', 2);
                    }
                } catch (error) {
                    showErrorMessage('Error processing dropped image', 2);
                }
            };
            reader.readAsDataURL(file);
        }
        // Handle URLs
        else if (urls.length > 0) {
            // Check for image URLs first and block them
            const imageUrls = urls.filter(url => isImageUrl(url));
            const regularUrls = urls.filter(url => !isImageUrl(url));

            if (imageUrls.length > 0) {
                showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
            }

            // Handle regular URLs
            regularUrls.forEach(urlString => {
                if (urlString.trim()) {
                    const extractedUrls = extractMultipleUrls(urlString);
                    if (extractedUrls.length > 0) {
                        extractedUrls.forEach(url => addLinkToEntry(entryIdx, url));
                    } else if (isValidUrl(urlString)) {
                        addLinkToEntry(entryIdx, urlString);
                    }
                }
            });
        }
        // Handle single URL from text
        else if (textData && isUrl(textData)) {
            if (isImageUrl(textData)) {
                showErrorMessage('Web image URLs are not supported. Please download the image and drag the file instead.', 2);
            } else {
                const extractedUrls = extractMultipleUrls(textData);
                if (extractedUrls.length > 0) {
                    extractedUrls.forEach(url => addLinkToEntry(entryIdx, url));
                } else if (isValidUrl(textData)) {
                    addLinkToEntry(entryIdx, textData);
                }
            }
        }
        
        // Prevent accidental click directly after drop, then fully restore
        const originalOnClick = entryDiv.onclick;

        setTimeout(() => {
            entryDiv.onclick = (e) => e.preventDefault();
            setTimeout(() => {
                entryDiv.onclick = originalOnClick;
            }, 100);
        }, 0);
    });
}

// =-=-=-=-=-
// NAVIGATION
// =-=-=-=-=-
function navigateToFolder(folderIndex) {
    const newPath = [...currentPath, folderIndex];
    addToHistory(newPath);
    currentPath = newPath;
    render();
}

function navigateToPath(newPath) {
    addToHistory(newPath);
    currentPath = [...newPath];
    clearSelection();
    clearSearch();
    render();
}

function navigateUp() {
    if (currentPath.length === 0) {
        showErrorMessage('Already at root folder', 1);
        return;
    }
    
    const newPath = currentPath.slice(0, -1);
    addToHistory(newPath);
    currentPath = newPath;
    clearSelection();
    clearSearch();
    render();
}

function navigateBack() {
    if (historyIndex <= 0) {
        showErrorMessage('No previous location in history', 1);
        return;
    }
    
    historyIndex--;
    const historyItem = navigationHistory[historyIndex];
    
    currentPath = [...(historyItem || [])];
    clearSearch();
    clearSelection();
    render();
}

function navigateForward() {
    if (historyIndex >= navigationHistory.length - 1) {
        showErrorMessage('No next location in history', 1);
        return;
    }
    
    historyIndex++;
    const historyItem = navigationHistory[historyIndex];
    
    currentPath = [...(historyItem || [])];
    clearSearch();
    clearSelection();
    render();
}

function navigateToSearchResult(result) {
    if (result.type === 'folder') {
        // Clear search state and navigate to folder
        const currentSearchTerm = searchResults ? searchResults.searchTerm : null;
        clearSearch();
        navigateToPath(result.path);

        // Keep search input value but clear search state
        if (currentSearchTerm) {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = currentSearchTerm;
            }
        }
    }
}

function initializeNavigationHistory() {
    if (navigationHistory.length === 0) {
        navigationHistory.push([]);  // Add root as first entry
        historyIndex = 0;
    }
}

function addToHistory(newPath) {
    // Remove any forward history if we're navigating to a new location
    if (historyIndex < navigationHistory.length - 1) {
        navigationHistory = navigationHistory.slice(0, historyIndex + 1);
    }
    
    // Add new path to history
    navigationHistory.push([...newPath]);
    historyIndex = navigationHistory.length - 1;
    
    // Limit history size to prevent memory issues
    if (navigationHistory.length > 50) {
        navigationHistory = navigationHistory.slice(-50);
        historyIndex = navigationHistory.length - 1;
    }
}

function savePathToSlot(slotNumber) {
    initializeSettings(); // Ensure settings are initialized
    
    // Check if slot already has a path
    const existingPath = data.settings.pathSlots[slotNumber];
    const isOverwriting = existingPath && Array.isArray(existingPath);
    
    // Save current path to the specified slot
    data.settings.pathSlots[slotNumber] = [...currentPath];
    
    // Auto-save the changes
    autoSave();
    
    // Show confirmation message
    const pathDisplay = getPathDisplayString(currentPath);
    const action = isOverwriting ? 'overwritten' : 'saved';
    showErrorMessage(`Path ${action} in slot ${slotNumber}: ${pathDisplay}`, 1);
}

function loadPathFromSlot(slotNumber) {
    initializeSettings(); // Ensure settings are initialized
    
    // Check if slot has a saved path
    const savedPath = data.settings.pathSlots[slotNumber];
    
    if (!savedPath || !Array.isArray(savedPath)) {
        return false; // Slot is empty
    }
    
    // Validate that the saved path still exists
    if (!isValidPath(savedPath)) {
        // Path no longer exists, clear the slot
        data.settings.pathSlots[slotNumber] = null;
        autoSave();
        showErrorMessage(`Path in slot ${slotNumber} no longer exists and has been cleared`, 2);
        return false;
    }
    
    // Navigate to the saved path
    const pathDisplay = getPathDisplayString(savedPath);
    navigateToPath(savedPath);
    
    showErrorMessage(`Switched to path from slot ${slotNumber}: ${pathDisplay}`, 1);
    return true;
}

// =-=-=-=-=-=-=-=
// CONTENT ACTIONS
// =-=-=-=-=-=-=-=
function createNewEntry(name, cover, links) {
    const folder = getCurrentFolder();
    const newEntry = {
        name: name,
        cover: cover,
        color: "#6c757d",
        links: Array.isArray(links) ? links.filter(link => link.trim()) : (links ? [links] : [])
    };
    applyDefaultSettings(newEntry, 'entry');
    folder.entries.push(newEntry);
    autoSave();
    render();
    refreshSearchIfActive();
}

function createEntryInFolder(folderIndex, link) {
    const folder = getCurrentFolder();
    const targetFolder = folder.folders[folderIndex];
    const newEntry = {
        name: `Link from ${extractDomainFromUrl(link)}`,
        cover: '',
        color: '#6c757d',
        links: [link]
    };
    applyDefaultSettings(newEntry, 'entry');
    targetFolder.entries.push(newEntry);
    autoSave();
    render();
    refreshSearchIfActive();
}

function saveFolderChanges(modal, folderIdx) {
    const currentFolder = getCurrentFolder();
    const targetFolder = currentFolder.folders[folderIdx];
    
    // Get original values for comparison
    const originalName = targetFolder.name || '';
    const originalColor = targetFolder.color || '#28a745';
    const originalCover = targetFolder.cover || '';
    const originalAspectRatio = targetFolder.aspectRatio || '8:3';
    const originalWhiteText = targetFolder.whiteText || false;
    const originalTags = targetFolder.folderTags || [];
    
    // Get new values from form
    let newName = modal.querySelector('#folder-name').value.trim();
    let newColor = modal.querySelector('#folder-color-hex').value.trim();
    const newCover = modal.querySelector('#folder-cover').value.trim();
    const newAspectRatio = modal.querySelector('#folder-aspect-ratio-select').value.trim();
    const whiteTextBtn = modal.querySelector('#white-text-btn');
    const newWhiteText = whiteTextBtn ? whiteTextBtn.classList.contains('active') : false;
    const newTagsInput = modal.querySelector('#folder-tags').value.trim();

    // Auto-fix hex color if needed
    if (newColor && !newColor.startsWith('#')) {
        // Try to add # prefix if it looks like a valid hex
        if (/^[0-9A-Fa-f]{6}$/.test(newColor)) {
            newColor = '#' + newColor;
            modal.querySelector('#folder-color-hex').value = newColor;
            modal.querySelector('#folder-color').value = newColor;
        }
    }
    
    // Validation
    if (!newName) {
        showErrorMessage('Folder name is required and cannot be empty', 2);
        modal.querySelector('#folder-name').focus();
        return;
    }
    
    if (!isValidHexColor(newColor)) {
        showErrorMessage('Invalid color format. Please use a valid hex color (e.g., #28a745)', 2);
        modal.querySelector('#folder-color-hex').focus();
        return;
    }
    
    if (!isValidImageUrl(newCover)) {
        showErrorMessage('Invalid cover image URL. Please use ./IMG/ path, file:// path, or leave empty', 2);
        modal.querySelector('#folder-cover').focus();
        return;
    }
    
    // Validate tags
    const tagValidation = validateTagInput(newTagsInput);
    if (!tagValidation.valid) {
        showErrorMessage(tagValidation.error, 2);
        modal.querySelector('#folder-tags').focus();
        return;
    }

    // Check what changed
    const changes = [];
    if (newName !== originalName) changes.push(`name from "${originalName}" to "${newName}"`);
    if (newColor !== originalColor) changes.push(`color from "${originalColor}" to "${newColor}"`);
    if (newCover !== originalCover) changes.push(`cover image`);
    if (newAspectRatio !== originalAspectRatio) changes.push(`aspect ratio from "${originalAspectRatio}" to "${newAspectRatio}"`);
    if (newWhiteText !== originalWhiteText) changes.push(`text color to ${newWhiteText ? 'white' : 'dark'}`);
    
    // Compare tags
    const originalTagsStr = JSON.stringify(originalTags.sort());
    const newTagsStr = JSON.stringify(tagValidation.tags.sort());
    if (originalTagsStr !== newTagsStr) {
        changes.push(`tags (${originalTags.length} → ${tagValidation.tags.length})`);
    }
    
    // Apply changes
    targetFolder.name = newName;
    targetFolder.color = newColor;
    targetFolder.cover = newCover || '';
    targetFolder.aspectRatio = newAspectRatio;
    targetFolder.whiteText = newWhiteText;
    targetFolder.folderTags = tagValidation.tags;
    
    autoSave();
    render();
    refreshSearchIfActive();
    modal.remove();
    
    if (changes.length > 0) {
        showErrorMessage(`Folder updated successfully! Changed: ${changes.join(', ')}`, 1);
    } else {
        showErrorMessage('No changes detected', 1);
    }
}

function saveEntryChanges(modal, entryIdx) {
    const currentFolder = getCurrentFolder();
    const targetEntry = currentFolder.entries[entryIdx];
    
    // Get original values for comparison
    const originalName = targetEntry.name || '';
    const originalColor = targetEntry.color || '#6c757d';
    const originalCover = targetEntry.cover || '';
    const originalAspectRatio = targetEntry.aspectRatio || '8:3';
    const originalLinks = targetEntry.links || [];
    const originalNote = targetEntry.note || '';
    const originalTags = targetEntry.entryTags || [];
    
    // Get new values from form
    let newName = modal.querySelector('#entry-name').value.trim();
    let newColor = modal.querySelector('#entry-color-hex').value.trim();
    const newCover = modal.querySelector('#entry-cover').value.trim();
    const newAspectRatio = modal.querySelector('#entry-aspect-ratio-select').value.trim();
    const newNote = modal.querySelector('#entry-note').value.trim();
    const newTagsInput = modal.querySelector('#entry-tags').value.trim();

    // Auto-fix hex color if needed
    if (newColor && !newColor.startsWith('#')) {
        // Try to add # prefix if it looks like a valid hex
        if (/^[0-9A-Fa-f]{6}$/.test(newColor)) {
            newColor = '#' + newColor;
            modal.querySelector('#entry-color-hex').value = newColor;
            modal.querySelector('#entry-color').value = newColor;
        }
    }
    
    // Collect and validate links
    const linkInputs = modal.querySelectorAll('.link-input');
    const newLinks = [];
    const invalidLinks = [];
    
    Array.from(linkInputs).forEach((input, index) => {
        const linkValue = input.value.trim();
        if (linkValue) {
            if (isValidLinkUrl(linkValue)) {
                newLinks.push(linkValue);
            } else {
                invalidLinks.push(`Link ${index + 1}: "${linkValue}"`);
            }
        }
    });
    
    // Validation
    if (!newName) {
        showErrorMessage('Entry name is required and cannot be empty', 2);
        modal.querySelector('#entry-name').focus();
        return;
    }
    
    if (!isValidHexColor(newColor)) {
        showErrorMessage('Invalid color format. Please use a valid hex color (e.g., #6c757d)', 2);
        modal.querySelector('#entry-color-hex').focus();
        return;
    }
    
    if (!isValidImageUrl(newCover)) {
        showErrorMessage('Invalid cover image URL. Please use ./IMG/ path, file:// path, or leave empty', 2);
        modal.querySelector('#entry-cover').focus();
        return;
    }
    
    if (invalidLinks.length > 0) {
        showErrorMessage(`Invalid link URLs detected: ${invalidLinks.join(', ')}. Please use valid URLs starting with http://, https://, or file://`, 2);
        return;
    }
    
    // Validate tags
    const tagValidation = validateTagInput(newTagsInput);
    if (!tagValidation.valid) {
        showErrorMessage(tagValidation.error, 2);
        modal.querySelector('#entry-tags').focus();
        return;
    }
    
    // Check what changed
    const changes = [];
    if (newName !== originalName) changes.push(`name from "${originalName}" to "${newName}"`);
    if (newColor !== originalColor) changes.push(`color from "${originalColor}" to "${newColor}"`);
    if (newCover !== originalCover) changes.push(`cover image`);
    if (newAspectRatio !== originalAspectRatio) changes.push(`aspect ratio from "${originalAspectRatio}" to "${newAspectRatio}"`);
    if (newNote !== originalNote) changes.push('note content');
    
    // Compare links
    const originalLinksStr = JSON.stringify(originalLinks.sort());
    const newLinksStr = JSON.stringify(newLinks.sort());
    if (originalLinksStr !== newLinksStr) {
        changes.push(`links (${originalLinks.length} → ${newLinks.length})`);
    }
    
    // Compare tags
    const originalTagsStr = JSON.stringify(originalTags.sort());
    const newTagsStr = JSON.stringify(tagValidation.tags.sort());
    if (originalTagsStr !== newTagsStr) {
        changes.push(`tags (${originalTags.length} → ${tagValidation.tags.length})`);
    }
    
    // Apply changes
    targetEntry.name = newName;
    targetEntry.color = newColor;
    targetEntry.cover = newCover || '';
    targetEntry.aspectRatio = newAspectRatio;
    targetEntry.links = newLinks;
    targetEntry.note = newNote;
    targetEntry.entryTags = tagValidation.tags;
    
    autoSave();
    render();
    refreshSearchIfActive();
    modal.remove();
    
    if (changes.length > 0) {
        showErrorMessage(`Entry updated successfully! Changed: ${changes.join(', ')}`, 1);
    } else {
        showErrorMessage('No changes detected', 1);
    }
}

function extractMultipleUrls(textData) {    
    if (!textData || !textData.trim()) return [];
    
    const text = textData.trim();
    const urls = [];
    
    // First check for line breaks
    if (text.includes('\n') || text.includes('\r')) {
        const result = text.split(/\r?\n/)
            .map(url => url.trim())
            .filter(url => url && (url.startsWith('http://') || url.startsWith('https://')))
            .filter(url => {
                try {
                    new URL(url);
                    return true;
                } catch {
                    return false;
                }
            });
        return result;
    }
    
    // Check for multiple http instances
    const httpMatches = text.match(/https?:\/\//g);
    if (!httpMatches || httpMatches.length <= 1) {
        // Single URL or no URLs
        if (text.startsWith('http://') || text.startsWith('https://')) {
            try {
                new URL(text);
                return [text];
            } catch {
                return [];
            }
        }
        return [];
    }
    
    // Multiple URLs detected - split them
    const parts = text.split(/(https?:\/\/)/).filter(part => part.trim());
    const reconstructedUrls = [];
    
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        
        // If this part is a protocol, combine it with the next part
        if (part === 'http://' || part === 'https://') {
            if (i + 1 < parts.length) {
                const nextPart = parts[i + 1];
                // Stop at the next protocol or end of string
                const urlPart = nextPart.split(/(?=https?:\/\/)/)[0].trim();
                const fullUrl = part + urlPart;
                
                try {
                    new URL(fullUrl);
                    reconstructedUrls.push(fullUrl);
                } catch {
                    // Invalid URL, skip
                }
                i++; // Skip the next part since we consumed it
            }
        }
    }
    
    return reconstructedUrls;
}

function deleteFolderWithConfirmation(folderIdx, onClose) {
    const currentFolder = getCurrentFolder();
    const targetFolder = currentFolder.folders[folderIdx];
    
    if (!targetFolder) {
        showErrorMessage('Folder not found', 2);
        return;
    }
    
    showDeleteConfirmationModal([{
        type: 'folder',
        index: folderIdx,
        name: targetFolder.name,
        item: targetFolder
    }], () => {
        currentFolder.folders.splice(folderIdx, 1);
        autoSave();
        render();
        if (onClose) onClose();
        showErrorMessage(`Folder "${targetFolder.name}" deleted successfully`, 1);
    });
}

function deleteEntryWithConfirmation(entryIdx, modal) {
    const currentFolder = getCurrentFolder();
    const targetEntry = currentFolder.entries[entryIdx];
    
    if (!targetEntry) {
        showErrorMessage('Entry not found', 2);
        return;
    }
    
    showDeleteConfirmationModal([{
        type: 'entry',
        index: entryIdx,
        name: targetEntry.name,
        item: targetEntry
    }], () => {
        currentFolder.entries.splice(entryIdx, 1);
        autoSave();
        
        // Close the edit modal first
        if (modal && modal.remove) {
            modal.remove();
        }
        
        // Then refresh the view
        if (isSearchActive && searchResults) {
            refreshSearchResults();
        } else {
            render();
        }
        
        showErrorMessage(`Entry "${targetEntry.name}" deleted successfully`, 1);
    });
}

function sortFoldersAndEntries(folders, entries, sortType) {
    const foldersCopy = [...folders];
    const entriesCopy = [...entries];
    
    switch (sortType) {
        case 'name-asc':
            foldersCopy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            entriesCopy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            break;
        case 'name-desc':
            foldersCopy.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
            entriesCopy.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
            break;
        case 'count-asc':
            foldersCopy.sort((a, b) => getTotalEntries(a) - getTotalEntries(b));
            entriesCopy.sort((a, b) => getLinksCount(a) - getLinksCount(b));
            break;
        case 'count-desc':
            foldersCopy.sort((a, b) => getTotalEntries(b) - getTotalEntries(a));
            entriesCopy.sort((a, b) => getLinksCount(b) - getLinksCount(a));
            break;
        default:
            // No sorting
            break;
    }
    
    return { folders: foldersCopy, entries: entriesCopy };
}

function addLinkToEntry(entryIndex, link) {
    const folder = getCurrentFolder();
    const entry = folder.entries[entryIndex];
    if (!entry.links) {
        entry.links = [];
    }
    entry.links.push(link);
    
    autoSave();
    render();
    refreshSearchIfActive();
}

function renderLinksFromJSON(links, container) {
    if (!container) return;
    
    container.innerHTML = '';
    
    // Create link inputs for each existing link from JSON
    links.forEach((link, index) => {
        if (link && link.trim()) {
            addNewLinkInput(container, link.trim());
        }
    });
    
    // If no links exist, add one empty field
    if (links.length === 0) {
        addNewLinkInput(container, '');
    }
    
    // Update modal width if many links
    const modal = container.closest('.modal-content');
    if (modal) {
        if (links.length > 6) {
            modal.classList.add('wide-modal');
            container.classList.add('scrollable-links');
        } else {
            modal.classList.remove('wide-modal');
            container.classList.remove('scrollable-links');
        }
    }
}

function addNewLinkInput(container, value = '') {
    const linkDiv = document.createElement('div');
    linkDiv.className = 'link-item';
    linkDiv.innerHTML = `
        <input type="url" class="link-input" value="${value}" placeholder="https://example.com">
        <button type="button" class="copy-link-btn" title="Copy link">🔗</button>
        <button type="button" class="remove-link-btn" title="Remove link">×</button>
    `;
    
    const input = linkDiv.querySelector('.link-input');
    const copyBtn = linkDiv.querySelector('.copy-link-btn');
    const removeBtn = linkDiv.querySelector('.remove-link-btn');
    
    // Copy link functionality
    copyBtn.onclick = async () => {
        const url = input.value.trim();
        if (!url) {
            showErrorMessage('Link is empty', 1);
            return;
        }
        
        try {
            await navigator.clipboard.writeText(url);
            showErrorMessage('Link copied to clipboard!', 1);
        } catch (error) {
            showErrorMessage('Failed to copy link to clipboard', 2);
        }
    };
    
    // Remove link functionality
    removeBtn.onclick = () => {
        linkDiv.remove();
        // If no links left, add one empty field
        if (container.children.length === 0) {
            addNewLinkInput(container, '');
        }
    };
    
    container.appendChild(linkDiv);
    return linkDiv;
}

function openAllLinks(links) {
    if (!links || links.length === 0) {
        showErrorMessage('No links to open', 1);
        return;
    }
    
    let openedCount = 0;
    links.forEach(link => {
        if (link && link.trim() && isValidLinkUrl(link.trim())) {
            try {
                window.open(link.trim(), '_blank');
                openedCount++;
            } catch (error) {
                console.warn('Failed to open link:', link);
            }
        }
    });
    
    if (openedCount > 0) {
        showErrorMessage(`Opened ${openedCount} link${openedCount !== 1 ? 's' : ''}`, 1);
    } else {
        showErrorMessage('No valid links found to open', 2);
    }
}

function handleEntryClick(entry, entryIdx) {
    initializeSettings();
    const currentFolder = getCurrentFolder();
    const targetEntry = currentFolder.entries[entryIdx];
    
    if (data.settings.entryClickAction === 'copyNote') {
        const note = targetEntry.note || '';
        if (!note.trim()) {
            showErrorMessage('Entry has no note to copy', 1);
            return;
        }
        
        navigator.clipboard.writeText(note).then(() => {
            showErrorMessage('Note copied to clipboard!', 1);
        }).catch(() => {
            showErrorMessage('Failed to copy note to clipboard', 2);
        });
    } else {
        // Default: open all links
        const links = targetEntry.links || [];
        const validLinks = links.filter(link => link && link.trim() && isValidLinkUrl(link.trim()));
        
        if (validLinks.length === 0) {
            showErrorMessage('Entry has no links to open', 1);
            return;
        }
        
        openAllLinks(validLinks);
    }
}

function parseTagsFromInput(tagInput) {
    if (!tagInput || !tagInput.trim()) {
        return [];
    }
    
    const tags = tagInput.split(';')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    
    return tags;
}

function formatTagsForDisplay(tags) {
    if (!tags || tags.length === 0) {
        return '';
    }
    return tags.join('; ') + (tags.length > 0 ? ';' : '');
}

function handleJsonDrop(jsonFile) {
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const jsonData = JSON.parse(e.target.result);
            
            // Basic validation - reusing existing validation logic
            if (!jsonData || typeof jsonData !== 'object') {
                showErrorMessage('Invalid JSON structure', 2);
                return;
            }
            
            // Get the file path - this is where the local path handling happens
            let filePath;
            if (jsonFile.path) {
                // Electron/desktop environment - we have the full path
                filePath = jsonFile.path;
                showErrorMessage(`JSON file loaded from: ${filePath}`, 1);
            } else {
                // Web environment - we can't get the actual file path
                // We'll need to save it to a default location and inform the user
                filePath = `./Profiles/imported_${Date.now()}_${jsonFile.name}`;
                showErrorMessage('Cannot access local file path in web browser. File will be saved to profiles directory.', 1);
            }
            
            // Save the JSON to the server with the determined path
            const response = await fetch('/save-json-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionPath: filePath,
                    data: jsonData,
                    fileName: jsonFile.name
                })
            });
            
            if (response.ok) {
                // Create new profile or update existing one
                const profileName = `imported_${Date.now()}`;
                const newProfile = {
                    name: profileName,
                    value: filePath
                };
                
                globalSettings.profiles.push(newProfile);
                globalSettings.activeSession = profileName;
                
                await saveGlobalSettings();
                
                // Load the new session
                data = jsonData;
                dataLoaded = true;
                currentPath = [];
                clearSelection();
                render();
                
                showErrorMessage(`JSON session loaded successfully! New profile "${profileName}" created and set as active.`, 1);
            } else {
                showErrorMessage('Failed to save JSON session to server', 2);
            }
            
        } catch (error) {
            showErrorMessage('Invalid JSON file format', 2);
            console.error('JSON drop error:', error);
        }
    };
    
    reader.onerror = function() {
        showErrorMessage('Failed to read JSON file', 2);
    };
    
    reader.readAsText(jsonFile);
}

// =-=-=-=-=-=-=-=-
// BATCH OPERATIONS
// =-=-=-=-=-=-=-=-
function toggleSelectionMode() {
    selectionMode = !selectionMode;
    const btn = document.getElementById('selection-toggle-btn');
    
    if (selectionMode) {
        btn.textContent = '✗ Cancel';
        btn.classList.add('active');
    } else {
        btn.textContent = '✓ Select Mode';
        btn.classList.remove('active');
        clearSelection();
    }
    
    // Maintain search state when toggling selection
    if (isSearchActive && searchResults) {
        refreshSearchResults();
    } else {
        render();
    }
}

function toggleSelection(itemId, element) {
    if (selectedItems.has(itemId)) {
        selectedItems.delete(itemId);
        element.classList.remove('selected');
        const checkbox = element.querySelector('.selection-checkbox');
        if (checkbox) checkbox.checked = false;
    } else {
        selectedItems.add(itemId);
        element.classList.add('selected');
        const checkbox = element.querySelector('.selection-checkbox');
        if (checkbox) checkbox.checked = true;
    }
    
    updateBatchActionsBar();
}

function selectAllItems() {
    if (isSearchActive && searchResults) {
        // Select all search results
        searchResults.results.forEach((result, index) => {
            selectedItems.add(`${result.type}:${index}`);
        });
    } else {
        // Select all items in current folder
        const folder = getCurrentFolder();
        
        folder.folders.forEach((_, idx) => {
            selectedItems.add(`folder:${idx}`);
        });
        
        folder.entries.forEach((_, idx) => {
            selectedItems.add(`entry:${idx}`);
        });
    }
    
    if (isSearchActive && searchResults) {
        refreshSearchResults();
    } else {
        render();
    }
}

function clearSelection() {
    selectedItems.clear();
    if (selectionMode) {
        selectionMode = false;
        const btn = document.getElementById('selection-toggle-btn');
        const pathBar = document.querySelector('.path-bar');
        const batchBar = document.getElementById('batch-actions-bar');
        
        if (btn) {
            btn.textContent = '✓ Select';
            btn.classList.remove('active');
        }
        // Restore path bar and remove replacement styling
        if (pathBar) pathBar.style.display = 'flex';
        if (batchBar) {
            batchBar.classList.remove('path-replacement');
            batchBar.classList.remove('show');
        }
    }
    updateBatchActionsBar();
    render();
}

function updateBatchActionsBar() {
    const bar = document.getElementById('batch-actions-bar');
    const counter = document.getElementById('batch-counter');
    
    if (!bar || !counter) return;
    
    const count = selectedItems.size;
    counter.textContent = `${count} item${count !== 1 ? 's' : ''} selected`;
    
    if (selectionMode) {
        bar.classList.add('show');
    } else {
        bar.classList.remove('show');
    }
}

function openAllSelectedItems() {
    const folder = getCurrentFolder();
    const allLinks = [];
    
    selectedItems.forEach(itemId => {
        const [type, index] = itemId.split(':');
        const idx = parseInt(index);
        
        if (type === 'entry') {
            const entry = folder.entries[idx];
            if (entry && entry.links) {
                entry.links.forEach(link => {
                    if (link && link.trim() && isValidLinkUrl(link.trim())) {
                        allLinks.push(link.trim());
                    }
                });
            }
        } else if (type === 'folder') {
            // For folders, collect all links from all entries recursively
            const folderData = folder.folders[idx];
            collectAllLinksFromFolder(folderData, allLinks);
        }
    });
    
    if (allLinks.length === 0) {
        showErrorMessage('No links found in selected items', 1);
        return;
    }
    
    openAllLinks(allLinks);
}

function duplicateSelectedItems() {
    const folder = getCurrentFolder();
    const itemsToDuplicate = [];
    
    // Collect items to duplicate
    selectedItems.forEach(itemId => {
        const [type, index] = itemId.split(':');
        if (type === 'folder') {
            itemsToDuplicate.push({
                type: 'folder',
                index: parseInt(index),
                item: folder.folders[parseInt(index)]
            });
        } else if (type === 'entry') {
            itemsToDuplicate.push({
                type: 'entry',
                index: parseInt(index),
                item: folder.entries[parseInt(index)]
            });
        }
    });
    
    // Create duplicates
    itemsToDuplicate.forEach(({type, item}) => {
        if (type === 'folder') {
            const duplicatedFolder = deepCloneItem(item);
            duplicatedFolder.name = item.name + '_Copy';
            folder.folders.push(duplicatedFolder);
        } else if (type === 'entry') {
            const duplicatedEntry = deepCloneItem(item);
            duplicatedEntry.name = item.name + '_Copy';
            folder.entries.push(duplicatedEntry);
        }
    });
    
    const count = itemsToDuplicate.length;
    showErrorMessage(`Successfully duplicated ${count} item${count !== 1 ? 's' : ''}`, 1);
    clearSelection();
    autoSave();
    render();
    refreshSearchIfActive();
}

function performMoveOperation(selectedDestination) {
    if (selectedDestination === null) {
        showErrorMessage('Please select a destination folder', 1);
        return false;
    }
    
    // Check if any folder is being moved into itself
    const validation = isMovingFolderIntoItself(selectedItems, selectedDestination);
    if (validation.isInvalid) {
        showErrorMessage(`Cannot move folder "${validation.folderName}" into itself or its subfolders. Please choose a different destination.`, 2);
        return false;
    }
    
    // Get source and destination folders
    const sourceFolder = getCurrentFolder();
    let destinationFolder = data;
    for (let idx of selectedDestination) {
        destinationFolder = destinationFolder.folders[idx];
    }
    
    // Collect items to move
    const itemsToMove = [];
    selectedItems.forEach(itemId => {
        const [type, index] = itemId.split(':');
        if (type === 'folder') {
            itemsToMove.push({
                type: 'folder',
                index: parseInt(index),
                item: sourceFolder.folders[parseInt(index)]
            });
        } else if (type === 'entry') {
            itemsToMove.push({
                type: 'entry', 
                index: parseInt(index),
                item: sourceFolder.entries[parseInt(index)]
            });
        }
    });
    
    // Sort by index descending to avoid index shifting issues when removing
    itemsToMove.sort((a, b) => b.index - a.index);
    
    // Move items
    itemsToMove.forEach(({type, index, item}) => {
        if (type === 'folder') {
            sourceFolder.folders.splice(index, 1);
            destinationFolder.folders.push(item);
        } else if (type === 'entry') {
            sourceFolder.entries.splice(index, 1);
            destinationFolder.entries.push(item);
        }
    });
    
    const count = itemsToMove.length;
    showErrorMessage(`Successfully moved ${count} item${count !== 1 ? 's' : ''}`, 1);
    clearSelection();
    autoSave();
    render();
    refreshSearchIfActive();
    return true;
}

function isMovingFolderIntoItself(selectedItems, destinationPath) {
    const currentFolder = getCurrentFolder();
    
    for (let itemId of selectedItems) {
        const [type, index] = itemId.split(':');
        if (type === 'folder') {
            const folderIndex = parseInt(index);
            // Get the path to the folder being moved
            const sourceFolderPath = [...currentPath, folderIndex];
            
            // Check if destination path starts with source folder path
            if (destinationPath.length >= sourceFolderPath.length) {
                const isSubpath = sourceFolderPath.every((pathIndex, i) => 
                    destinationPath[i] === pathIndex
                );
                if (isSubpath) {
                    return {
                        isInvalid: true,
                        folderName: currentFolder.folders[folderIndex].name
                    };
                }
            }
        }
    }
    
    return { isInvalid: false };
}

function exportSelectedItemsAsJson() {
    const currentFolder = getCurrentFolder();
    const selectedFolders = [];
    const selectedEntries = [];
    
    // Collect selected items
    selectedItems.forEach(itemId => {
        const [type, index] = itemId.split(':');
        const idx = parseInt(index);
        
        if (type === 'folder' && currentFolder.folders[idx]) {
            selectedFolders.push(deepCloneItem(currentFolder.folders[idx]));
        } else if (type === 'entry' && currentFolder.entries[idx]) {
            selectedEntries.push(deepCloneItem(currentFolder.entries[idx]));
        }
    });
    
    // Create new JSON with selected items as root
    const exportData = createEmptyJsonData();
    exportData.folders = selectedFolders;
    exportData.entries = selectedEntries;
    
    try {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `batch_export_${timestamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        const count = selectedItems.size;
        showErrorMessage(`Successfully exported ${count} item${count !== 1 ? 's' : ''} as JSON!`, 1);
    } catch (error) {
        showErrorMessage('Failed to export selected items', 2);
        console.error('Export error:', error);
    }
}

function deleteSelectedItemsWithConfirmation() {
    const selectedCount = selectedItems.size;
    if (selectedCount === 0) {
        showErrorMessage('No items selected for deletion', 1);
        return;
    }
    
    const currentFolder = getCurrentFolder();
    const itemsToDelete = [];
    
    // Collect items
    selectedItems.forEach(itemId => {
        const [type, index] = itemId.split(':');
        const idx = parseInt(index);
        
        if (type === 'folder' && currentFolder.folders[idx]) {
            const folder = currentFolder.folders[idx];
            itemsToDelete.push({
                type: 'folder',
                index: idx,
                name: folder.name,
                item: folder
            });
        } else if (type === 'entry' && currentFolder.entries[idx]) {
            const entry = currentFolder.entries[idx];
            itemsToDelete.push({
                type: 'entry',
                index: idx,
                name: entry.name,
                item: entry
            });
        }
    });
    
    if (itemsToDelete.length === 0) {
        showErrorMessage('No valid items found for deletion', 2);
        return;
    }
    
    showDeleteConfirmationModal(itemsToDelete, () => {
        // Sort by index descending to avoid index shifting issues
        itemsToDelete.sort((a, b) => b.index - a.index);
        
        // Delete items
        itemsToDelete.forEach(({type, index}) => {
            if (type === 'folder') {
                currentFolder.folders.splice(index, 1);
            } else if (type === 'entry') {
                currentFolder.entries.splice(index, 1);
            }
        });
        
        const deletedCount = itemsToDelete.length;
        showErrorMessage(`Successfully deleted ${deletedCount} item${deletedCount !== 1 ? 's' : ''}`, 1);
        
        clearSelection();
        autoSave();
        render();
        refreshSearchIfActive();
    });
}

// =-=-=-=-=-=-=-=-
// SEARCH UTILITIES
// =-=-=-=-=-=-=-=-
function initializeSearchFunctionality() {
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const searchInput = document.getElementById('search-input');
    
    searchToggleBtn.onclick = handleSearchToggle;
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('focus', handleSearchFocus);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    
    document.addEventListener('click', handleSearchOutsideClick);
}

function performSearch(searchText) {
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    searchTimeout = setTimeout(() => {
        executeSearch(searchText);
    }, 1000);
}

function executeSearch(searchText) {
    if (!searchText || !searchText.trim()) {
        clearSearch();
        return;
    }
    
    const trimmedSearch = searchText.trim();
    const results = performSearchOperation(trimmedSearch, getCurrentFolder(), [...currentPath]);
    
    // Only add to history if this is a new search (not from history navigation)
    const lastHistoryItem = navigationHistory[historyIndex];
    const isFromHistory = lastHistoryItem && lastHistoryItem.type === 'search' && lastHistoryItem.searchTerm === trimmedSearch;
    
    if (!isFromHistory) {
        addSearchToHistory(trimmedSearch);
    }
    
    if (results.length === 0) {
        displaySearchResults([], trimmedSearch);
        return;
    }
    
    displaySearchResults(results, trimmedSearch);
}

function handleSearchToggle() {
    const toggleBtn = document.getElementById('search-toggle-btn');
    const searchContainer = document.getElementById('search-bar-container');
    const searchInput = document.getElementById('search-input');
    const helpBox = document.getElementById('search-help-box');
    
    if (!searchExpanded) {
        searchExpanded = true;
        toggleBtn.classList.add('active');
        toggleBtn.style.display = 'none';
        searchContainer.classList.add('expanded');
        
        setTimeout(() => {
            searchInput.focus();
            if (!searchInput.value.trim()) {
                helpBox.classList.add('visible');
            }
        }, 100);
    }
}

function handleSearchInput(e) {
    const searchText = e.target.value;
    const helpBox = document.getElementById('search-help-box');
    const clearBtn = document.getElementById('search-clear-btn');
    
    if (searchText.trim()) {
        helpBox.classList.remove('visible');
        if (clearBtn) {
            clearBtn.style.display = 'block';
        } else {
            addSearchClearButton();
        }
        performSearch(searchText);
    } else {
        helpBox.classList.add('visible');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
        clearSearch();
    }
}

function handleSearchFocus() {
    const searchInput = document.getElementById('search-input');
    const helpBox = document.getElementById('search-help-box');
    
    if (!searchInput.value.trim()) {
        helpBox.classList.add('visible');
    }
}

function handleSearchOutsideClick(e) {
    const searchContainer = document.getElementById('search-container');
    const toggleBtn = document.getElementById('search-toggle-btn');
    const searchBarContainer = document.getElementById('search-bar-container');
    const helpBox = document.getElementById('search-help-box');
    const searchInput = document.getElementById('search-input');
    
    if (searchExpanded && !searchContainer.contains(e.target)) {
        if (!searchInput.value.trim()) {
            searchExpanded = false;
            toggleBtn.classList.remove('active');
            toggleBtn.style.display = 'flex';
            searchBarContainer.classList.remove('expanded');
            helpBox.classList.remove('visible');
            clearSearch();
        }
    }
}

function handleSearchKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const searchText = e.target.value.trim();
        if (searchText) {
            // Clear existing timeout and search immediately
            if (searchTimeout) {
                clearTimeout(searchTimeout);
            }
            executeSearch(searchText);
        }
    }
}

function addSearchClearButton() {
    const searchContainer = document.getElementById('search-bar-container');
    const clearBtn = document.createElement('button');
    clearBtn.id = 'search-clear-btn';
    clearBtn.className = 'search-clear-btn';
    clearBtn.innerHTML = '×';
    clearBtn.title = 'Clear search';
    clearBtn.onclick = clearSearchInput;
    searchContainer.appendChild(clearBtn);
}

function clearSearchInput() {
    const searchInput = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    
    searchInput.value = '';
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    clearSearch();
    
    const helpBox = document.getElementById('search-help-box');
    helpBox.classList.add('visible');
}

function refreshSearchResults() {
    if (isSearchActive && searchResults && searchResults.searchTerm) {
        const results = performSearchOperation(searchResults.searchTerm, getCurrentFolder(), [...currentPath]);
        searchResults.results = results;
        displaySearchResults(results, searchResults.searchTerm);
    }
}

function refreshSearchIfActive() {
    if (isSearchActive && searchResults && searchResults.searchTerm) {
        const results = performSearchOperation(searchResults.searchTerm, getCurrentFolder(), [...currentPath]);
        searchResults.results = results;
        displaySearchResults(results, searchResults.searchTerm);
    }
}

function performSearchOperation(searchText, folder, currentFolderPath) {
    const results = [];
    const searchQueries = parseSearchQuery(searchText);
    searchInFolder(folder, currentFolderPath, searchQueries, results);
    return results;
}

function toggleSearchResultSelection(itemId, element) {
    if (selectedItems.has(itemId)) {
        selectedItems.delete(itemId);
        element.classList.remove('selected');
        const checkbox = element.querySelector('.selection-checkbox');
        if (checkbox) checkbox.checked = false;
    } else {
        selectedItems.add(itemId);
        element.classList.add('selected');
        const checkbox = element.querySelector('.selection-checkbox');
        if (checkbox) checkbox.checked = true;
    }
    
    updateBatchActionsBar();
}

function setupSearchResultDragDrop(contentDiv) {
    let dragCounter = 0;

    contentDiv.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        contentDiv.classList.add('drag-over');
    });

    contentDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    contentDiv.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            contentDiv.classList.remove('drag-over');
        }
    });

    contentDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        contentDiv.classList.remove('drag-over');

        // For search results, we don't handle drops
        showErrorMessage('Drag and drop not available in search results', 1);
    });
}

function parseSearchQuery(searchText) {
    const queries = [];
    
    if (searchText.includes('.') && searchText.includes(' ')) {
        const parts = searchText.split(';').map(part => part.trim()).filter(part => part);
        
        for (const part of parts) {
            if (part.startsWith('.')) {
                const spaceIndex = part.indexOf(' ');
                if (spaceIndex > 0) {
                    const keyword = part.substring(1, spaceIndex).toLowerCase();
                    const searchTerm = part.substring(spaceIndex + 1).trim();
                    
                    if (searchTerm) {
                        queries.push({
                            type: 'keyword',
                            keyword: keyword,
                            term: searchTerm.toLowerCase()
                        });
                    }
                }
            } else {
                queries.push({
                    type: 'general',
                    term: part.toLowerCase()
                });
            }
        }
    } else {
        queries.push({
            type: 'general',
            term: searchText.toLowerCase()
        });
    }
    
    return queries;
}

function searchInFolder(folder, folderPath, queries, results) {
    if (folder.folders) {
        folder.folders.forEach((subfolder, index) => {
            const subfolderPath = [...folderPath, index];
            
            if (matchesSearchQueries(subfolder, 'folder', queries)) {
                results.push({
                    type: 'folder',
                    item: subfolder,
                    path: subfolderPath,
                    pathDisplay: getPathDisplayString(subfolderPath)
                });
            }
            
            searchInFolder(subfolder, subfolderPath, queries, results);
        });
    }
    
    if (folder.entries) {
        folder.entries.forEach((entry, index) => {
            if (matchesSearchQueries(entry, 'entry', queries)) {
                results.push({
                    type: 'entry',
                    item: entry,
                    path: folderPath,
                    entryIndex: index,
                    pathDisplay: getPathDisplayString(folderPath)
                });
            }
        });
    }
}

function matchesSearchQueries(item, itemType, queries) {
    return queries.every(query => matchesSingleQuery(item, itemType, query));
}

function matchesSingleQuery(item, itemType, query) {
    if (query.type === 'general') {
        const searchTerm = query.term;
        
        if (item.name && item.name.toLowerCase().includes(searchTerm)) {
            return true;
        }
        
        const tags = itemType === 'folder' ? (item.folderTags || []) : (item.entryTags || []);
        if (tags.some(tag => tag.toLowerCase().includes(searchTerm))) {
            return true;
        }
        
        if (itemType === 'entry' && item.links) {
            if (item.links.some(link => link && link.toLowerCase().includes(searchTerm))) {
                return true;
            }
        }
        
        return false;
    } else if (query.type === 'keyword') {
        const keyword = query.keyword;
        const searchTerm = query.term;
        
        switch (keyword) {
            case 'name':
                return item.name && item.name.toLowerCase().includes(searchTerm);
            case 'fname':
                return itemType === 'folder' && item.name && item.name.toLowerCase().includes(searchTerm);
            case 'ename':
                return itemType === 'entry' && item.name && item.name.toLowerCase().includes(searchTerm);
            case 'link':
                return itemType === 'entry' && item.links && 
                       item.links.some(link => link && link.toLowerCase().includes(searchTerm));
            case 'tag':
                const allTags = itemType === 'folder' ? (item.folderTags || []) : (item.entryTags || []);
                return allTags.some(tag => tag.toLowerCase().includes(searchTerm));
            case 'ftag':
                return itemType === 'folder' && (item.folderTags || []).some(tag => tag.toLowerCase().includes(searchTerm));
            case 'etag':
                return itemType === 'entry' && (item.entryTags || []).some(tag => tag.toLowerCase().includes(searchTerm));
            default:
                return false;
        }
    }
    
    return false;
}

function displaySearchResults(results, searchTerm) {
    isSearchActive = true;
    searchResults = { results, searchTerm };
    
    const mainView = document.getElementById('main-view');
    mainView.innerHTML = '';
    
    const searchHeader = document.createElement('div');
    searchHeader.className = 'search-results-header';
    searchHeader.innerHTML = `
        <div class="search-results-info">
            <h3>Search Results for: "${searchTerm}"</h3>
            <p>Found ${results.length} result${results.length === 1 ? '' : 's'}</p>
        </div>
        <div class="search-nav-buttons">
            <button class="nav-button" id="search-up-btn" title="Go to parent folder">↑</button>
            <button class="nav-button" id="search-back-btn" title="Go back">←</button>
            <button class="nav-button" id="search-forward-btn" title="Go forward">→</button>
        </div>
    `;
    mainView.appendChild(searchHeader);

    // Setup navigation buttons
    const upBtn = searchHeader.querySelector('#search-up-btn');
    const backBtn = searchHeader.querySelector('#search-back-btn');
    const forwardBtn = searchHeader.querySelector('#search-forward-btn');

    upBtn.onclick = () => navigateUp();
    backBtn.onclick = () => navigateBack();
    forwardBtn.onclick = () => navigateForward();

    // Update button states
    if (currentPath.length === 0) {
        upBtn.classList.add('disabled');
    }
    if (historyIndex <= 0) {
        backBtn.classList.add('disabled');
    }
    if (historyIndex >= navigationHistory.length - 1) {
        forwardBtn.classList.add('disabled');
    }
    
    const contentWrapper = document.createElement('div');
    contentWrapper.style.padding = '20px';
    
    // Create and append batch actions bar
    const batchBar = createBatchActionsBar();
    contentWrapper.appendChild(batchBar);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-container search-results';

    setupSearchResultDragDrop(contentDiv);
    
    const sortedResults = sortSearchResults(results, currentSort);
    
    sortedResults.forEach((result, displayIndex) => {
        const div = document.createElement('div');
        div.className = result.type === 'folder' ? 'folder search-result' : 'entry search-result';
        
        // Add selection mode support
        if (selectionMode) {
            div.classList.add('selection-mode');
            const itemId = `${result.type}:${displayIndex}`;
            if (selectedItems.has(itemId)) {
                div.classList.add('selected');
            }
        }
        
        if (result.type === 'folder') {
            const totalEntries = getTotalEntries(result.item);
            div.innerHTML = `
                ${selectionMode ? `<input type="checkbox" class="selection-checkbox" ${selectedItems.has(`folder:${displayIndex}`) ? 'checked' : ''}>` : ''}
                <img src="${result.item.cover || '/static/images/folder.png'}" alt="Cover" title="${result.item.cover ? 'Folder cover image' : 'Default folder icon'}" onerror="this.src='/static/images/folder.png'">
                <div class="folder-name">📁 ${result.item.name}</div>
                <div class="folder-count">${totalEntries} entries</div>
                <div class="search-result-path">📍 ${result.pathDisplay}</div>
            `;
        } else {
            const linksCount = getLinksCount(result.item);
            div.innerHTML = `
                ${selectionMode ? `<input type="checkbox" class="selection-checkbox" ${selectedItems.has(`entry:${displayIndex}`) ? 'checked' : ''}>` : ''}
                <img src="${result.item.cover || '/static/images/entry.png'}" alt="Cover" title="${result.item.cover ? 'Entry cover image' : 'Default entry icon'}" onerror="this.src='/static/images/entry.png'">
                <div class="entry-title">${result.item.name}</div>
                <div class="entry-links-count">${linksCount} links</div>
                <div class="search-result-path">📍 ${result.pathDisplay}</div>
            `;
        }
        
        // Add selection checkbox functionality
        if (selectionMode) {
            const checkbox = div.querySelector('.selection-checkbox');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                const itemId = `${result.type}:${displayIndex}`;
                toggleSearchResultSelection(itemId, div);
            };
        }
        
        div.onclick = (e) => {
            if (e.defaultPrevented) return;
            if (selectionMode) {
                const itemId = `${result.type}:${displayIndex}`;
                toggleSearchResultSelection(itemId, div);
            } else {
                if (result.type === 'entry') {
                    // Handle entry click directly during search
                    const originalPath = [...currentPath];
                    currentPath = [...result.path];
                    handleEntryClick(result.item, result.entryIndex);
                    currentPath = originalPath; // Restore path immediately
                } else {
                    navigateToSearchResult(result);
                }
            }
        };

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (result.type === 'folder') {
                // Store current search state
                const currentSearchState = {
                    isActive: isSearchActive,
                    results: searchResults ? { ...searchResults } : null,
                    currentPath: [...currentPath],
                    searchTerm: searchResults ? searchResults.searchTerm : null
                };
                
                // Temporarily set path for the modal operations
                const originalPath = [...currentPath];
                currentPath = [...result.path.slice(0, -1)];
                
                // Get the folder index within its parent
                const folderIdx = result.path[result.path.length - 1];
                
                showFolderEditModal(result.item, folderIdx, () => {
                    // Restore search state after modal closes
                    currentPath = originalPath;
                    if (currentSearchState.isActive && currentSearchState.results) {
                        isSearchActive = currentSearchState.isActive;
                        searchResults = currentSearchState.results;
                        // Re-execute search to get updated results
                        if (currentSearchState.searchTerm) {
                            const newResults = performSearchOperation(currentSearchState.searchTerm, getCurrentFolder(), [...currentPath]);
                            displaySearchResults(newResults, currentSearchState.searchTerm);
                        }
                    }
                });
            } else {
                // Store current search state
                const currentSearchState = {
                    isActive: isSearchActive,
                    results: searchResults ? { ...searchResults } : null,
                    currentPath: [...currentPath],
                    searchTerm: searchResults ? searchResults.searchTerm : null
                };
                
                // Temporarily set path for the modal operations
                const originalPath = [...currentPath];
                currentPath = [...result.path];
                
                showEntryEditModal(result.item, result.entryIndex, () => {
                    // Restore search state after modal closes
                    currentPath = originalPath;
                    if (currentSearchState.isActive && currentSearchState.results) {
                        isSearchActive = currentSearchState.isActive;
                        searchResults = currentSearchState.results;
                        // Re-execute search to get updated results
                        if (currentSearchState.searchTerm) {
                            const newResults = performSearchOperation(currentSearchState.searchTerm, getCurrentFolder(), [...currentPath]);
                            displaySearchResults(newResults, currentSearchState.searchTerm);
                        }
                    }
                });
            }
        });

        contentDiv.appendChild(div);
    });
    
    if (results.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-message';
        emptyDiv.textContent = `No results found for "${searchTerm}"`;
        contentDiv.appendChild(emptyDiv);
    }
    
    contentWrapper.appendChild(contentDiv);
    mainView.appendChild(contentWrapper);
    
    // Update batch actions bar
    updateBatchActionsBar();
    
    setTimeout(() => {
        applySearchResultColors();
        applySearchResultAspectRatios();
    }, 0);
}

function sortSearchResults(results, sortType) {
    const resultsCopy = [...results];
    
    switch (sortType) {
        case 'name-asc':
            resultsCopy.sort((a, b) => (a.item.name || '').localeCompare(b.item.name || ''));
            break;
        case 'name-desc':
            resultsCopy.sort((a, b) => (b.item.name || '').localeCompare(a.item.name || ''));
            break;
        case 'count-asc':
            resultsCopy.sort((a, b) => {
                const aCount = a.type === 'folder' ? getTotalEntries(a.item) : getLinksCount(a.item);
                const bCount = b.type === 'folder' ? getTotalEntries(b.item) : getLinksCount(b.item);
                return aCount - bCount;
            });
            break;
        case 'count-desc':
            resultsCopy.sort((a, b) => {
                const aCount = a.type === 'folder' ? getTotalEntries(a.item) : getLinksCount(a.item);
                const bCount = b.type === 'folder' ? getTotalEntries(b.item) : getLinksCount(b.item);
                return bCount - aCount;
            });
            break;
    }
    
    return resultsCopy;
}

function applySearchResultColors() {
    if (!searchResults || !searchResults.results) return;
    
    const folders = document.querySelectorAll('.folder.search-result');
    const entries = document.querySelectorAll('.entry.search-result');
    
    const sortedResults = sortSearchResults(searchResults.results, currentSort);
    
    folders.forEach((folderElement, index) => {
        // Find the folder result at this display index
        const folderResults = sortedResults.filter(r => r.type === 'folder');
        if (folderResults[index]) {
            const folder = folderResults[index].item;
            const color = folder.color || '#28a745';
            const whiteText = folder.whiteText || false;
            
            const variations = createColorVariations(color, 'folder');
            folderElement.style.setProperty('--folder-bg-color', variations.gradient);
            folderElement.style.setProperty('--folder-border-color', variations.border);
            
            const folderName = folderElement.querySelector('.folder-name');
            const folderCount = folderElement.querySelector('.folder-count');
            const searchResultPath = folderElement.querySelector('.search-result-path');
            
            if (whiteText) {
                folderName.style.color = 'white';
                folderCount.style.color = '#e0e0e0e0';
                if (searchResultPath) searchResultPath.style.color = 'white';
            } else {
                folderName.style.color = '#333';
                folderCount.style.color = '#474747ff';
                if (searchResultPath) searchResultPath.style.color = '#333';
            }
        }
    });
    
    entries.forEach((entryElement, index) => {
        // Find the entry result at this display index
        const entryResults = sortedResults.filter(r => r.type === 'entry');
        if (entryResults[index]) {
            const entry = entryResults[index].item;
            const color = entry.color || '#6c757d';
            const variations = createColorVariations(color, 'entry');
            entryElement.style.setProperty('--entry-border-color', variations.gradient);
        }
    });
}

function applySearchResultColors() {
    if (!searchResults || !searchResults.results) return;
    
    const folders = document.querySelectorAll('.folder.search-result');
    const entries = document.querySelectorAll('.entry.search-result');
    
    const sortedResults = sortSearchResults(searchResults.results, currentSort);
    
    // Process folders
    let folderIndex = 0;
    folders.forEach((folderElement) => {
        const folderResults = sortedResults.filter(r => r.type === 'folder');
        if (folderResults[folderIndex]) {
            const folder = folderResults[folderIndex].item;
            const color = folder?.color || '#28a745';
            const whiteText = folder?.whiteText || false;
            
            // Create color variations for folder
            const variations = createColorVariations(color, 'folder');
            
            folderElement.style.setProperty('--folder-bg-color', variations.gradient);
            folderElement.style.setProperty('--folder-border-color', variations.border);
            
            // Apply text colors
            const folderName = folderElement.querySelector('.folder-name');
            const folderCount = folderElement.querySelector('.folder-count');
            const searchResultPath = folderElement.querySelector('.search-result-path');
            
            if (whiteText) {
                folderName.style.color = 'white';
                folderCount.style.color = '#e0e0e0e0';
                if (searchResultPath) searchResultPath.style.color = 'white';
            } else {
                folderName.style.color = '#333';
                folderCount.style.color = '#474747ff';
                if (searchResultPath) searchResultPath.style.color = '#333';
            }
            folderIndex++;
        }
    });
    
    // Process entries
    let entryIndex = 0;
    entries.forEach((entryElement) => {
        const entryResults = sortedResults.filter(r => r.type === 'entry');
        if (entryResults[entryIndex]) {
            const entry = entryResults[entryIndex].item;
            const color = entry?.color || '#6c757d';
            
            // Create color variations for entry
            const variations = createColorVariations(color, 'entry');
            
            entryElement.style.setProperty('--entry-border-color', variations.gradient);
            entryIndex++;
        }
    });
}

function navigateToSearchResult(result) {
    if (result.type === 'folder') {
        const currentSearchTerm = searchResults ? searchResults.searchTerm : null;
        navigateToPath(result.path);

        // If we had a search active, keep search input value but clear results view
        if (currentSearchTerm) {
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = currentSearchTerm;
            }
        }
    } else {
        // The entry click will be handled by handleEntryClick
        return;
    }
}

function clearSearch() {
    isSearchActive = false;
    searchResults = null;
    
    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }
    
    // Clear selection when exiting search
    selectedItems.clear();
    
    render();
}

function addSearchToHistory(searchTerm) {
    // Remove any forward history if we're navigating to a new location
    if (historyIndex < navigationHistory.length - 1) {
        navigationHistory = navigationHistory.slice(0, historyIndex + 1);
    }
    
    const searchState = {
        type: 'search',
        searchTerm: searchTerm,
        path: [...currentPath]
    };
    
    navigationHistory.push(searchState);
    historyIndex = navigationHistory.length - 1;
    
    // Limit history size to prevent memory issues
    if (navigationHistory.length > 50) {
        navigationHistory = navigationHistory.slice(-50);
        historyIndex = navigationHistory.length - 1;
    }
}

// =-=-=-=-=-=-=
// MODAL DIALOGS
// =-=-=-=-=-=-=
function showCreateFolderModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create New Folder</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Folder Name:</label>
                    <input type="text" id="new-folder-name" placeholder="Enter folder name" autofocus>
                </div>
                <div class="modal-actions">
                    <button id="create-folder-btn" type="button" class="btn-primary">Create</button>
                    <button id="cancel-folder-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus the input after modal is added
    setTimeout(() => {
        modal.querySelector('#new-folder-name').focus();
    }, 100);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#cancel-folder-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Create folder functionality
    const createFolder = () => {
        const name = modal.querySelector('#new-folder-name').value.trim();
        if (!name) {
            showErrorMessage('Folder name is required and cannot be empty', 2);
            modal.querySelector('#new-folder-name').focus();
            return;
        }
        
        const folder = getCurrentFolder();
        const newFolder = {
            name: name,
            cover: "",
            folders: [],
            entries: []
        };
        applyDefaultSettings(newFolder, 'folder');
        folder.folders.push(newFolder);
        autoSave();
        modal.remove();
        showErrorMessage(`Folder "${name}" created successfully!`, 1);

        // Refresh search if active, otherwise render normally
        if (isSearchActive && searchResults) {
            refreshSearchResults();
        } else {
            render();
        }
    };
    
    modal.querySelector('#create-folder-btn').onclick = createFolder;
    
    // Handle Enter key
    modal.querySelector('#new-folder-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createFolder();
        }
    });
    
    setupModalEscapeKey(modal);
}

function showCreateEntryModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create New Entry</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Entry Name:</label>
                    <input type="text" id="new-entry-name" placeholder="Enter entry name" autofocus>
                </div>
                <div class="modal-actions">
                    <button id="create-entry-btn" type="button" class="btn-primary">Create</button>
                    <button id="cancel-entry-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus the input after modal is added
    setTimeout(() => {
        modal.querySelector('#new-entry-name').focus();
    }, 100);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#cancel-entry-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Create entry functionality
    const createEntry = () => {
        const name = modal.querySelector('#new-entry-name').value.trim();
        if (!name) {
            showErrorMessage('Entry name is required and cannot be empty', 2);
            modal.querySelector('#new-entry-name').focus();
            return;
        }
        
        const folder = getCurrentFolder();
        const newEntry = {
            name: name,
            cover: "",
            links: []
        };
        applyDefaultSettings(newEntry, 'entry');
        folder.entries.push(newEntry);
        autoSave();
        modal.remove();
        showErrorMessage(`Entry "${name}" created successfully!`, 1);

        // Refresh search if active, otherwise render normally
        if (isSearchActive && searchResults) {
            refreshSearchResults();
        } else {
            render();
        }
    };
    
    modal.querySelector('#create-entry-btn').onclick = createEntry;
    
    // Handle Enter key
    modal.querySelector('#new-entry-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createEntry();
        }
    });
    
    setupModalEscapeKey(modal);
}

function showFolderEditModal(folder, folderIdx, onCloseCallback) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit Folder: ${folder.name}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Folder Name:</label>
                    <input type="text" id="folder-name" value="${folder.name || ''}" placeholder="Enter folder name">
                </div>
                
                <div class="form-group">
                    <label>Color Theme:</label>
                    <div class="color-picker-row">
                        <div class="color-picker-group">
                            <input type="color" id="folder-color" value="${folder.color || '#28a745'}">
                            <input type="text" id="folder-color-hex" value="${folder.color || '#28a745'}" placeholder="#28a745">
                            <button type="button" id="reset-folder-color-btn">Reset</button>
                        </div>
                        <div class="white-text-group">
                            <button type="button" id="white-text-btn" class="${folder.whiteText ? 'active' : ''}">White Text</button>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="cover-header">
                        <span class="expand-arrow" id="cover-arrow">▸</span>
                        <label>Cover Image:</label>
                    </div>
                    <div id="cover-section" class="expandable-content">
                        <input type="url" id="folder-cover" value="${folder.cover || ''}" placeholder="./IMG/image.jpg or file:// path only">
                        <div class="cover-preview" style="margin-top: 10px;">
                            ${folder.cover ? `<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Current cover: ${getDisplayableImageSource(folder.cover)}</div>` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button type="button" id="upload-folder-cover-btn" class="btn-with-hover-text" data-hover-text="Upload Image" title="Upload Image">📂</button>
                                <button type="button" id="paste-folder-cover-btn" class="btn-with-hover-text" data-hover-text="Paste URL" title="Paste URL">📋</button>
                                <div class="aspect-ratio-dropdown">
                                    <select id="folder-aspect-ratio-select">
                                        <option value="3:4" ${(folder.aspectRatio || '8:3') === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                        <option value="1:1" ${(folder.aspectRatio || '8:3') === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                        <option value="3:2" ${(folder.aspectRatio || '8:3') === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                        <option value="8:3" ${(folder.aspectRatio || '8:3') === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                    </select>
                                </div>
                            </div>
                            <button type="button" id="clear-folder-cover-btn">Reset</button>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="tags-header">
                        <span class="expand-arrow" id="tags-arrow">▸</span>
                        <label>Tags:</label>
                    </div>
                    <div id="tags-section" class="expandable-content">
                        <textarea id="folder-tags" class="tags-textarea" placeholder="Enter tags separated by semicolons: tag1; tag2; tag3;" rows="1">${formatTagsForDisplay(folder.folderTags || [])}</textarea>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button id="save-folder-btn" type="button" class="btn-primary">💾 Save Changes</button>
                    <button id="duplicate-folder-btn" type="button" class="btn-secondary">📄 Duplicate Folder</button>
                    <button id="delete-folder-btn" type="button" class="btn-danger">🗑️ Delete Folder</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Setup expandable sections
    setupExpandableSection('cover-header', 'cover-arrow', 'cover-section', true);
    setupExpandableSection('tags-header', 'tags-arrow', 'tags-section', true);
    
    // Auto-resize textarea
    const tagsTextarea = modal.querySelector('#folder-tags');
    tagsTextarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.max(38, this.scrollHeight) + 'px';
    });
    
    // Sync color picker and hex input
    const colorPicker = modal.querySelector('#folder-color');
    const hexInput = modal.querySelector('#folder-color-hex');
    
    colorPicker.oninput = () => {
        hexInput.value = colorPicker.value;
    };
    
    hexInput.oninput = () => {
        if (/^#[0-9A-F]{6}$/i.test(hexInput.value)) {
            colorPicker.value = hexInput.value;
        }
    };
    
    const closeModal = () => {
        modal.remove();
        if (onCloseCallback) onCloseCallback();
    };

    // Event listeners
    modal.querySelector('.close-btn').onclick = () => closeModal();
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            closeModal();
        }
        mouseDownOnModal = false;
    });

    modal.querySelector('#reset-folder-color-btn').onclick = () => {
        const defaultColor = '#28a745';
        colorPicker.value = defaultColor;
        hexInput.value = defaultColor;
    };

    modal.querySelector('#white-text-btn').onclick = (e) => {
        e.preventDefault();
        const btn = modal.querySelector('#white-text-btn');
        const currentState = btn.classList.contains('active');
        
        if (currentState) {
            btn.classList.remove('active');
            btn.textContent = 'White Text';
        } else {
            btn.classList.add('active');
            btn.textContent = 'White Text';
        }
    };

    modal.querySelector('#upload-folder-cover-btn').onclick = () => {
        const folder = getCurrentFolder().folders[folderIdx];
        const folderName = folder.name || 'folder';
        handleImageUpload('folder-cover', 'folder', folderIdx, folderName);
    };
    
    modal.querySelector('#paste-folder-cover-btn').onclick = () => handlePasteUrl('folder-cover');
    modal.querySelector('#clear-folder-cover-btn').onclick = () => {
        modal.querySelector('#folder-cover').value = '';
    };
    
    // Aspect ratio change handler
    modal.querySelector('#folder-aspect-ratio-select').onchange = (e) => {
        const selectedRatio = e.target.value;
        applyAspectRatio('folder', folderIdx, selectedRatio);
    };
    
    modal.querySelector('#save-folder-btn').onclick = () => {
        saveFolderChanges(modal, folderIdx);
    };

    modal.querySelector('#duplicate-folder-btn').onclick = () => {
        const currentFolder = getCurrentFolder();
        const targetFolder = currentFolder.folders[folderIdx];
    
        const duplicatedFolder = deepCloneItem(targetFolder);
        duplicatedFolder.name = targetFolder.name + '/Copy';
        currentFolder.folders.push(duplicatedFolder);
    
        autoSave();
        render();
        closeModal()
        showErrorMessage('Folder duplicated successfully!', 1);
    };

    modal.querySelector('#delete-folder-btn').onclick = () => {
        deleteFolderWithConfirmation(folderIdx, closeModal);
    };
    
    const handleEscKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
            document.removeEventListener('keydown', handleEscKey);
        }
    };
    document.addEventListener('keydown', handleEscKey);
}

function showEntryEditModal(entryData, entryIdx, onCloseCallback) {
    const currentFolder = getCurrentFolder();
    const actualEntry = currentFolder.entries[entryIdx];
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Edit Entry: ${actualEntry.name || 'Unnamed Entry'}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Entry Name:</label>
                    <input type="text" id="entry-name" value="${actualEntry.name || ''}" placeholder="Enter entry name">
                </div>

                <div class="form-group">
                    <label>Color Theme:</label>
                    <div class="color-picker-group">
                        <input type="color" id="entry-color" value="${actualEntry.color || '#6c757d'}">
                        <input type="text" id="entry-color-hex" value="${actualEntry.color || '#6c757d'}" placeholder="#6c757d">
                        <button type="button" id="reset-entry-color-btn">Reset</button>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="cover-header">
                        <span class="expand-arrow" id="cover-arrow">▸</span>
                        <label>Cover Image:</label>
                    </div>
                    <div id="cover-section" class="expandable-content">
                        <input type="url" id="entry-cover" value="${actualEntry.cover || ''}" placeholder="./IMG/image.jpg or file:// path only">
                        <div class="cover-preview" style="margin-top: 10px;">
                            ${actualEntry.cover ? `<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Current cover: ${getDisplayableImageSource(actualEntry.cover)}</div>` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; gap: 10px; align-items: center;">
                                <button type="button" id="upload-entry-cover-btn" class="btn-with-hover-text" data-hover-text="Upload Image" title="Upload Image">📂</button>
                                <button type="button" id="paste-entry-cover-btn" class="btn-with-hover-text" data-hover-text="Paste URL" title="Paste URL">📋</button>
                                <div class="aspect-ratio-dropdown">
                                    <select id="entry-aspect-ratio-select">
                                        <option value="3:4" ${(actualEntry.aspectRatio || '8:3') === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                        <option value="1:1" ${(actualEntry.aspectRatio || '8:3') === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                        <option value="3:2" ${(actualEntry.aspectRatio || '8:3') === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                        <option value="8:3" ${(actualEntry.aspectRatio || '8:3') === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                    </select>
                                </div>
                            </div>
                            <button type="button" id="clear-entry-cover-btn">Reset</button>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="links-header">
                        <span class="expand-arrow" id="links-arrow">▼</span>
                        <label>Links:</label>
                    </div>
                    <div id="links-section" class="expandable-content">
                        <div id="links-container"></div>
                        <div style="margin-top: 15px; display: flex; gap: 10px;">
                            <button id="add-link-btn" type="button" class="btn-success">+ Add Link</button>
                            <button id="open-all-btn" type="button" class="btn-info">🚀 Open All Links</button>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="note-header">
                        <span class="expand-arrow" id="note-arrow">▼</span>
                        <label>Note:</label>
                    </div>
                    <div id="note-section" class="expandable-content">
                        <textarea id="entry-note" placeholder="Enter your notes here..." rows="6">${actualEntry.note || ''}</textarea>
                        <div style="margin-top: 10px;">
                            <button id="copy-note-btn" type="button" class="btn-info">📋 Copy Note</button>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <div class="expandable-header" id="tags-header">
                        <span class="expand-arrow" id="tags-arrow">▸</span>
                        <label>Tags:</label>
                    </div>
                    <div id="tags-section" class="expandable-content">
                        <textarea id="entry-tags" class="tags-textarea" placeholder="Enter tags separated by semicolons: tag1; tag2; tag3;" rows="1">${formatTagsForDisplay(actualEntry.entryTags || [])}</textarea>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button id="save-entry-btn" type="button" class="btn-primary">💾 Save Changes</button>
                        <button id="duplicate-entry-btn" type="button" class="btn-secondary">📄 Duplicate Entry</button>
                        <button id="delete-entry-btn" type="button" class="btn-danger">🗑️ Delete Entry</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Render links from JSON data
    const linksContainer = modal.querySelector('#links-container');
    renderLinksFromJSON(actualEntry.links || [], linksContainer);
    
    setupExpandableSection('cover-header', 'cover-arrow', 'cover-section', true);
    setupExpandableSection('links-header', 'links-arrow', 'links-section');
    setupExpandableSection('note-header', 'note-arrow', 'note-section');
    setupExpandableSection('tags-header', 'tags-arrow', 'tags-section', true);
    
    // Auto-resize textarea
    const tagsTextarea = modal.querySelector('#entry-tags');
    tagsTextarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.max(38, this.scrollHeight) + 'px';
    });
    
    // Sync color picker and hex input
    const colorPicker = modal.querySelector('#entry-color');
    const hexInput = modal.querySelector('#entry-color-hex');
    
    colorPicker.oninput = () => {
        hexInput.value = colorPicker.value;
    };
    
    hexInput.oninput = () => {
        if (/^#[0-9A-F]{6}$/i.test(hexInput.value)) {
            colorPicker.value = hexInput.value;
        }
    };
    
    const closeModal = () => {
        modal.remove();
        if (onCloseCallback) onCloseCallback();
    };

    // Event listeners
    modal.querySelector('.close-btn').onclick = () => closeModal();
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            closeModal();
        }
        mouseDownOnModal = false;
    });
    
    // Links management
    modal.querySelector('#add-link-btn').onclick = () => {
        const linksContainer = modal.querySelector('#links-container');
        addNewLinkInput(linksContainer, '');
    };
    
    // Copy note functionality
    modal.querySelector('#copy-note-btn').onclick = async () => {
        const noteText = modal.querySelector('#entry-note').value;
        if (!noteText.trim()) {
            showErrorMessage('Note is empty', 1);
            return;
        }
        
        try {
            await navigator.clipboard.writeText(noteText);
            showErrorMessage('Note copied to clipboard!', 1);
        } catch (error) {
            showErrorMessage('Failed to copy note to clipboard', 2);
        }
    };
    
    // Other button handlers
    modal.querySelector('#reset-entry-color-btn').onclick = () => {
        const defaultColor = '#6c757d';
        colorPicker.value = defaultColor;
        hexInput.value = defaultColor;
    };

    modal.querySelector('#upload-entry-cover-btn').onclick = () => {
        const entry = getCurrentFolder().entries[entryIdx];
        const entryName = entry.name || 'entry';
        handleImageUpload('entry-cover', 'entry', entryIdx, entryName);
    };
    
    modal.querySelector('#paste-entry-cover-btn').onclick = () => handlePasteUrl('entry-cover');
    modal.querySelector('#clear-entry-cover-btn').onclick = () => {
        modal.querySelector('#entry-cover').value = '';
    };
    
    modal.querySelector('#entry-aspect-ratio-select').onchange = (e) => {
        const selectedRatio = e.target.value;
        applyAspectRatio('entry', entryIdx, selectedRatio);
    };
    
    modal.querySelector('#open-all-btn').onclick = () => {
        const linkInputs = modal.querySelectorAll('.link-input');
        const links = [];
        Array.from(linkInputs).forEach(input => {
            const linkValue = input.value.trim();
            if (linkValue && isValidLinkUrl(linkValue)) {
                links.push(linkValue);
            }
        });
    
        if (links.length === 0) {
            showErrorMessage('No valid links to open', 1);
            return;
        }
    
        openAllLinks(links);
    };
    modal.querySelector('#duplicate-entry-btn').onclick = () => {
        const currentFolder = getCurrentFolder();
        const targetEntry = currentFolder.entries[entryIdx];
    
        const duplicatedEntry = deepCloneItem(targetEntry);
        duplicatedEntry.name = targetEntry.name + '/Copy';
        currentFolder.entries.push(duplicatedEntry);
    
        autoSave();
        render();
        closeModal()
        showErrorMessage('Entry duplicated successfully!', 1);
    };
    
    modal.querySelector('#save-entry-btn').onclick = () => {
        saveEntryChanges(modal, entryIdx);
    };
    
    modal.querySelector('#delete-entry-btn').onclick = () => {
        deleteEntryWithConfirmation(entryIdx, closeModal);
    };
    
    const handleEscKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
            document.removeEventListener('keydown', handleEscKey);
        }
    };
    document.addEventListener('keydown', handleEscKey);
}

function showMoveModal() {
    const selectedCount = selectedItems.size;
    if (selectedCount === 0) {
        showErrorMessage('No items selected for moving', 1);
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Move ${selectedCount} Item${selectedCount !== 1 ? 's' : ''}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>Select destination folder:</label>
                    <div class="folder-tree" id="folder-tree"></div>
                </div>
                <div class="modal-actions">
                    <button id="move-confirm-btn" type="button" class="btn-primary">📁 Move Here</button>
                    <button id="move-cancel-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Build folder tree
    const tree = modal.querySelector('#folder-tree');
    let selectedDestination = [];
    
    function buildFolderTree(folder, path = [], indent = 0) {
        const isCurrentPath = JSON.stringify(path) === JSON.stringify(currentPath);
        const option = document.createElement('div');
        option.className = 'folder-option';
        if (isCurrentPath) {
            option.classList.add('disabled');
        }
        
        option.style.paddingLeft = `${indent * 20 + 12}px`;
        option.innerHTML = `${'  '.repeat(indent)}📁 ${path.length === 0 ? 'Root' : folder.name}`;
        
        if (!isCurrentPath) {
            option.onclick = () => {
                // Remove previous selection
                tree.querySelectorAll('.folder-option.selected').forEach(opt => {
                    opt.classList.remove('selected');
                });
                option.classList.add('selected');
                selectedDestination = [...path];
            };
        } else {
            option.title = 'Cannot move to current folder';
        }
        
        tree.appendChild(option);
        
        // Add subfolders
        if (folder.folders) {
            folder.folders.forEach((subfolder, index) => {
                buildFolderTree(subfolder, [...path, index], indent + 1);
            });
        }
    }
    
    buildFolderTree(data);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#move-cancel-btn').onclick = () => modal.remove();
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Move functionality
    modal.querySelector('#move-confirm-btn').onclick = () => {
        if (performMoveOperation(selectedDestination)) {
            modal.remove();
        }
    };
    
    setupModalEscapeKey(modal);
}

function showHelpModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay help-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Usage Guide</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="help-item">
                    <div class="help-icon">✖️</div>
                    <div>Press ESC in any menu to exit</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">🖱️</div>
                    <div>Right click a Folder/Entry to edit</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">📁</div>
                    <div>Left click a folder to open it</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">⚙️</div>
                    <div>Configure left click entry action in Settings</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">🖱️</div>
                    <div>Drag images/URLs to create entries</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">📋</div>
                    <div>Use Selection mode for batch operations</div>
                </div>
                <div class="help-item search-help-special">
                    <div class="help-icon">🔍</div>
                    <div>Press '/' key or search button to perform search</div>
                </div>
                <div class="search-development-note">
                    Search functionality is under heavy development and some features may not work as intended
                </div>
                <div class="help-item">
                    <div class="help-icon">👤</div>
                    <div>Use profiles in Settings to manage different JSON files</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">⚙️</div>
                    <div>Set default properties for new items in Settings</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">🔢</div>
                    <div>Use Alt+1/2/3 to Save and QuickSwitch between paths</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">📂</div>
                    <div>Drag images onto folders/entries to set covers</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">🔗</div>
                    <div>Drag URLs onto entries to add links</div>
                </div>
            </div>
            <div class="help-modal-actions">
                <button id="welcome-btn" type="button" class="help-action-btn welcome-btn">ℹ️ Quick Start</button>
                <button id="changelog-btn" type="button" class="help-action-btn changelog-btn">📰 Changelog</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    
    modal.querySelector('#welcome-btn').onclick = () => {
        modal.remove();
        showWelcomeModal();
    };
    
    modal.querySelector('#changelog-btn').onclick = () => {
        modal.remove();
        showChangelogModal();
    };
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });

    setupModalEscapeKey(modal);
}

function showWelcomeModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay welcome-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Welcome to Stashhub</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body welcome-modal-body">
                <div class="welcome-indicators">
                    <div class="welcome-indicator active"></div>
                    <div class="welcome-indicator"></div>
                    <div class="welcome-indicator"></div>
                    <div class="welcome-indicator"></div>
                </div>
                
                <div class="welcome-slide active">
                    <div class="welcome-slide-text">
                        <h4>Welcome to Your Personal Bookmark Manager!</h4>
                        <p>This powerful tool helps you organize your bookmarks, links, and notes in a visual and intuitive way. Let's take a quick tour to get you started.</p>
                    </div>
                </div>
                
                <div class="welcome-slide">
                    <img src="/static/images/welcome-slide1.png" alt="Welcome Slide 1" class="welcome-slide-image" onerror="this.style.display='none'">
                    <div class="welcome-slide-text">
                        <h4>Organize with Folders and Entries</h4>
                        <p>Create folders to categorize your content and entries to store your bookmarks. Right-click any item to edit it, and drag & drop new links or images to add new content effortlessly.</p>
                    </div>
                </div>
                
                <div class="welcome-slide">
                    <img src="/static/images/welcome-slide2.png" alt="Welcome Slide 2" class="welcome-slide-image" onerror="this.style.display='none'">
                    <div class="welcome-slide-text">
                        <h4>Customize Your Experience</h4>
                        <p>Personalize your folders and entries with custom colors, cover images, and aspect ratios. Use the Settings menu to configure default properties and behaviors to match your workflow.</p>
                    </div>
                </div>
                
                <div class="welcome-slide">
                    <div class="welcome-slide-text">
                        <h4>You're All Set!</h4>
                        <p>That's the basics covered! You can always access the usage guide for detailed instructions or check the changelog for recent updates.</p>
                        <p><strong>Press ESC to close this welcome message and start using the app.</strong></p>
                        <div class="welcome-final-actions">
                            <button class="welcome-action-btn welcome-close-btn">✅ Start Using App</button>
                            <button class="welcome-action-btn welcome-help-btn">ℹ️ Usage Guide</button>
                            <button class="welcome-action-btn welcome-changelog-btn">📰 View Changelog</button>
                        </div>
                    </div>
                </div>
                
                <div class="welcome-navigation">
                    <button class="welcome-nav-btn" id="welcome-prev-btn">‹</button>
                    <button class="welcome-nav-btn" id="welcome-next-btn">›</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    let currentSlide = 0;
    const slides = modal.querySelectorAll('.welcome-slide');
    const indicators = modal.querySelectorAll('.welcome-indicator');
    const prevBtn = modal.querySelector('#welcome-prev-btn');
    const nextBtn = modal.querySelector('#welcome-next-btn');
    
    function updateSlide() {
        // Hide all slides and deactivate indicators
        slides.forEach((slide, index) => {
            slide.classList.toggle('active', index === currentSlide);
        });
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === currentSlide);
        });
        
        // Update navigation buttons visibility and state
        if (currentSlide === 0) {
            // First slide: only show right arrow
            prevBtn.style.opacity = '0';
            prevBtn.style.pointerEvents = 'none';
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'all';
            nextBtn.disabled = false;
        } else if (currentSlide === slides.length - 1) {
            // Last slide: only show left arrow
            prevBtn.style.opacity = '1';
            prevBtn.style.pointerEvents = 'all';
            prevBtn.disabled = false;
            nextBtn.style.opacity = '0';
            nextBtn.style.pointerEvents = 'none';
        } else {
            // Middle slides: show both arrows
            prevBtn.style.opacity = '1';
            prevBtn.style.pointerEvents = 'all';
            prevBtn.disabled = false;
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'all';
            nextBtn.disabled = false;
        }
    }
    
    function nextSlide() {
        if (currentSlide < slides.length - 1) {
            currentSlide++;
            updateSlide();
        }
    }
    
    function prevSlide() {
        if (currentSlide > 0) {
            currentSlide--;
            updateSlide();
        }
    }
    
    function goToSlide(index) {
        currentSlide = index;
        updateSlide();
    }
    
    // Event listeners
    prevBtn.onclick = prevSlide;
    nextBtn.onclick = nextSlide;
    
    // Indicator clicks
    indicators.forEach((indicator, index) => {
        indicator.onclick = () => goToSlide(index);
    });
    
    // Final action buttons
    modal.querySelector('.welcome-close-btn').onclick = () => modal.remove();
    modal.querySelector('.welcome-help-btn').onclick = () => {
        modal.remove();
        showHelpModal();
    };
    modal.querySelector('.welcome-changelog-btn').onclick = () => {
        modal.remove();
        showChangelogModal();
    };
    
    // Keyboard navigation
    const handleKeydown = (e) => {
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prevSlide();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextSlide();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            modal.remove();
            document.removeEventListener('keydown', handleKeydown);
        }
    };
    document.addEventListener('keydown', handleKeydown);
    
    // Close functionality
    modal.querySelector('.close-btn').onclick = () => {
        modal.remove();
        document.removeEventListener('keydown', handleKeydown);
    };
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
            document.removeEventListener('keydown', handleKeydown);
        }
        mouseDownOnModal = false;
    });
    
    // Initialize first slide
    updateSlide();
}

function showChangelogModal() {
    const isUpdateAvailable = isNewerVersionAvailable();
    const versionStatusClass = isUpdateAvailable ? 'version-outdated' : 'version-current';
    const versionTooltip = isUpdateAvailable ? 'Newer version available' : 'Up to date';
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay changelog-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Changelog</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body changelog-modal-body" id="changelog-content">
                <div class="changelog-loading">Loading changelog...</div>
            </div>
            <div class="changelog-modal-actions">
                <div class="version-status">
                    <span class="current-version ${versionStatusClass}" title="${versionTooltip}">Current Version: ${APP_VERSION}</span>
                </div>
                <div class="changelog-buttons">
                    <button id="changelog-release-btn" type="button" class="changelog-release-btn">📄 Release Page</button>
                    <button id="changelog-cancel-btn" type="button" class="changelog-cancel-btn">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Load changelog content
    loadChangelogContent();
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#changelog-cancel-btn').onclick = () => modal.remove();
    modal.querySelector('#changelog-release-btn').onclick = () => {
        window.open('https://github.com/Ventexx/Stashhub/releases', '_blank');
    };
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    setupModalEscapeKey(modal);
}

function showSettingsModal() {
    initializeSettings();
    loadGlobalSettings();
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay settings-modal';
    modal.innerHTML = `
        <div class="modal-content settings-modal-content">
            <div class="modal-header">
                <h3>Settings</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body settings-modal-body">
                <div class="settings-left-column">
                    <div class="settings-section">
                        <h4>Default Settings for New Items</h4>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Default Folder Aspect Ratio:</label>
                            <div class="settings-control">
                                <select id="default-folder-aspect-ratio">
                                    <option value="3:4" ${data.settings.defaultFolderAspectRatio === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                    <option value="1:1" ${data.settings.defaultFolderAspectRatio === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                    <option value="3:2" ${data.settings.defaultFolderAspectRatio === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                    <option value="8:3" ${data.settings.defaultFolderAspectRatio === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Default Folder Color:</label>
                            <div class="settings-control">
                                <div class="color-picker-group">
                                    <input type="color" id="default-folder-color" class="color-picker-square" value="${data.settings.defaultFolderColor || '#28a745'}">
                                    <input type="text" id="default-folder-color-hex" value="${data.settings.defaultFolderColor || '#28a745'}" placeholder="#28a745">
                                    <button type="button" id="reset-default-folder-color-btn" class="reset-btn-square" title="Reset">🔄</button>
                                </div>
                            </div>
                        </div>

                        <div class="settings-form-group">
                            <label class="settings-label">Default Entry Aspect Ratio:</label>
                            <div class="settings-control">
                                <select id="default-entry-aspect-ratio">
                                    <option value="3:4" ${data.settings.defaultEntryAspectRatio === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                    <option value="1:1" ${data.settings.defaultEntryAspectRatio === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                    <option value="3:2" ${data.settings.defaultEntryAspectRatio === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                    <option value="8:3" ${data.settings.defaultEntryAspectRatio === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                </select>
                            </div>
                        </div>

                        <div class="settings-form-group">
                            <label class="settings-label">Default Entry Color:</label>
                            <div class="settings-control">
                                <div class="color-picker-group">
                                    <input type="color" id="default-entry-color" class="color-picker-square" value="${data.settings.defaultEntryColor || '#6c757d'}">
                                    <input type="text" id="default-entry-color-hex" value="${data.settings.defaultEntryColor || '#6c757d'}" placeholder="#6c757d">
                                    <button type="button" id="reset-default-entry-color-btn" class="reset-btn-square" title="Reset">🔄</button>
                                </div>
                            </div>
                        </div>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Use white text for new folders:</label>
                            <div class="settings-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" id="default-folder-white-text" ${data.settings.defaultFolderWhiteText ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>Edit Menu Behavior</h4>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Sections expanded by default:</label>
                            <div class="settings-control">
                                <button type="button" id="sections-expanded-btn" class="btn-secondary">Configure...</button>
                            </div>
                        </div>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Left click entry action:</label>
                            <div class="settings-control">
                                <select id="entry-click-action">
                                    <option value="openLinks" ${data.settings.entryClickAction === 'openLinks' ? 'selected' : ''}>🚀 Open All Links</option>
                                    <option value="copyNote" ${data.settings.entryClickAction === 'copyNote' ? 'selected' : ''}>📋 Copy Note</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-divider"></div>

                <div class="settings-right-column">
                    <div class="profile-management-section">
                        <h4>Profile Management</h4>
                        <div id="profiles-container">
                            <!-- Profiles will be rendered here -->
                        </div>
                        <div class="add-profile-btn" id="add-profile-btn">+</div>
                    </div>
                </div>
            </div>
            
            <div class="modal-actions settings-modal-actions">
                <button id="save-settings-btn" type="button" class="btn-primary">💾 Save Settings</button>
                <button id="cancel-settings-btn" type="button" class="btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Render profiles
    renderProfilesList();
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#cancel-settings-btn').onclick = () => modal.remove();
    modal.querySelector('#add-profile-btn').onclick = createNewProfile;

    // Color picker sync for default folder color
    const defaultFolderColorPicker = modal.querySelector('#default-folder-color');
    const defaultFolderHexInput = modal.querySelector('#default-folder-color-hex');

    defaultFolderColorPicker.oninput = () => {
        defaultFolderHexInput.value = defaultFolderColorPicker.value;
    };

    defaultFolderHexInput.oninput = () => {
        if (/^#[0-9A-F]{6}$/i.test(defaultFolderHexInput.value)) {
            defaultFolderColorPicker.value = defaultFolderHexInput.value;
        }
    };

    modal.querySelector('#reset-default-folder-color-btn').onclick = () => {
        const defaultColor = '#28a745';
        defaultFolderColorPicker.value = defaultColor;
        defaultFolderHexInput.value = defaultColor;
    };

    // Color picker sync for default entry color
    const defaultEntryColorPicker = modal.querySelector('#default-entry-color');
    const defaultEntryHexInput = modal.querySelector('#default-entry-color-hex');

    defaultEntryColorPicker.oninput = () => {
        defaultEntryHexInput.value = defaultEntryColorPicker.value;
    };

    defaultEntryHexInput.oninput = () => {
        if (/^#[0-9A-F]{6}$/i.test(defaultEntryHexInput.value)) {
            defaultEntryColorPicker.value = defaultEntryHexInput.value;
        }
    };

    modal.querySelector('#reset-default-entry-color-btn').onclick = () => {
        const defaultColor = '#6c757d';
        defaultEntryColorPicker.value = defaultColor;
        defaultEntryHexInput.value = defaultColor;
    };

    // Add event listener for sections expanded button
    modal.querySelector('#sections-expanded-btn').onclick = () => showSectionsExpandedModal();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    modal.querySelector('#save-settings-btn').onclick = () => {
        data.settings.defaultFolderAspectRatio = modal.querySelector('#default-folder-aspect-ratio').value;
        data.settings.defaultFolderColor = modal.querySelector('#default-folder-color-hex').value;
        data.settings.defaultEntryAspectRatio = modal.querySelector('#default-entry-aspect-ratio').value;
        data.settings.defaultEntryColor = modal.querySelector('#default-entry-color-hex').value;
        data.settings.defaultFolderWhiteText = modal.querySelector('#default-folder-white-text').checked;
        data.settings.entryClickAction = modal.querySelector('#entry-click-action').value;
        
        autoSave();
        modal.remove();
        showErrorMessage('Settings saved successfully!', 1);
    };
    
    setupModalEscapeKey(modal);
}

function showSectionsExpandedModal() {
    initializeSettings();
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay sections-expanded-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Default Section Behavior</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div style="margin-bottom: 15px; color: #666; font-size: 13px; text-align: center;">
                    Choose which sections expand by default when editing items
                </div>
                
                <div class="settings-form-group">
                    <label class="settings-label">🖼️ Cover Image</label>
                    <div class="settings-control">
                        <label class="toggle-switch">
                            <input type="checkbox" id="cover-expanded-default" ${data.settings.coverExpandedByDefault ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <div class="settings-form-group">
                    <label class="settings-label">🔗 Links</label>
                    <div class="settings-control">
                        <label class="toggle-switch">
                            <input type="checkbox" id="links-expanded-default" ${data.settings.linksExpandedByDefault ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <div class="settings-form-group">
                    <label class="settings-label">📝 Notes</label>
                    <div class="settings-control">
                        <label class="toggle-switch">
                            <input type="checkbox" id="notes-expanded-default" ${data.settings.noteExpandedByDefault ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <div class="settings-form-group">
                    <label class="settings-label">🏷️ Tags</label>
                    <div class="settings-control">
                        <label class="toggle-switch">
                            <input type="checkbox" id="tags-expanded-default" ${data.settings.tagsExpandedByDefault ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <div class="modal-actions" style="margin-top: 20px;">
                    <button id="save-sections-btn" type="button" class="btn-primary">💾 Save</button>
                    <button id="cancel-sections-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#cancel-sections-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    modal.querySelector('#save-sections-btn').onclick = () => {
        data.settings.coverExpandedByDefault = modal.querySelector('#cover-expanded-default').checked;
        data.settings.linksExpandedByDefault = modal.querySelector('#links-expanded-default').checked;
        data.settings.noteExpandedByDefault = modal.querySelector('#notes-expanded-default').checked;
        data.settings.tagsExpandedByDefault = modal.querySelector('#tags-expanded-default').checked;
        
        autoSave();
        modal.remove();
        showErrorMessage('Section settings saved successfully!', 1);
    };
    
    setupModalEscapeKey(modal);
}

function showCreateJsonModal(profileName, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Create New JSON?</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <div style="margin-bottom: 20px;">This profile has no JSON assigned.<br>Would you like to create a new empty JSON file for this profile?</div>
                </div>
                <div class="modal-actions">
                    <button id="create-json-btn" type="button" class="btn-primary">Create New JSON</button>
                    <button id="create-cancel-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#create-cancel-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Create confirmation
    modal.querySelector('#create-json-btn').onclick = () => {
        modal.remove();
        onConfirm();
    };
    
    setupModalEscapeKey(modal);
}

function showDeleteConfirmationModal(itemsToDelete, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    // Create header text
    let headerText = 'Delete ';
    if (itemsToDelete.length === 1) {
        headerText += itemsToDelete[0].type === 'folder' ? 'Folder?' : 'Entry?';
    } else {
        headerText += 'Selected Items?';
    }
    
    // Create content description
    let contentDescription = 'This will delete:\n';
    
    if (itemsToDelete.length === 1) {
        const item = itemsToDelete[0];
        if (item.type === 'folder') {
            const totalEntries = getTotalEntries(item.item);
            const subfolderCount = item.item.folders ? item.item.folders.length : 0;
            
            if (totalEntries === 0 && subfolderCount === 0) {
                contentDescription += 'Empty folder';
            } else {
                const parts = [];
                if (subfolderCount > 0) {
                    parts.push(`${subfolderCount} Subfolder${subfolderCount !== 1 ? 's' : ''}`);
                }
                if (totalEntries > 0) {
                    parts.push(`${totalEntries} Entr${totalEntries !== 1 ? 'ies' : 'y'}`);
                }
                contentDescription += parts.join(' and ');
            }
        } else {
            const linksCount = getLinksCount(item.item);
            const hasNote = item.item.note && item.item.note.trim();
            
            if (linksCount === 0 && !hasNote) {
                contentDescription += 'Empty entry';
            } else {
                const parts = [];
                if (linksCount > 0) {
                    parts.push(`${linksCount} Link${linksCount !== 1 ? 's' : ''}`);
                }
                if (hasNote) {
                    parts.push('1 Note');
                }
                contentDescription += parts.join(' and ');
            }
        }
    } else {
        // Multiple items
        const folderCount = itemsToDelete.filter(item => item.type === 'folder').length;
        const entryCount = itemsToDelete.filter(item => item.type === 'entry').length;
        
        const parts = [];
        if (folderCount > 0) {
            parts.push(`${folderCount} Folder${folderCount !== 1 ? 's' : ''}`);
        }
        if (entryCount > 0) {
            parts.push(`${entryCount} Entr${entryCount !== 1 ? 'ies' : 'y'}`);
        }
        contentDescription += parts.join(' and ');
    }
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${headerText}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <div style="margin-bottom: 20px; white-space: pre-line;">${contentDescription}</div>
                </div>
                <div class="modal-actions">
                    <button id="delete-confirm-btn" type="button" class="btn-danger">Delete</button>
                    <button id="delete-cancel-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#delete-cancel-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Delete confirmation
    modal.querySelector('#delete-confirm-btn').onclick = () => {
        modal.remove();
        onConfirm();
    };
    
    setupModalEscapeKey(modal);
}

function showDeleteProfileModal(profileName, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Delete Profile?</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <div style="margin-bottom: 20px;">Are you sure you want to delete profile "${profileName}"?<br>This action cannot be undone.</div>
                </div>
                <div class="modal-actions">
                    <button id="delete-profile-confirm-btn" type="button" class="btn-danger">Delete</button>
                    <button id="delete-profile-cancel-btn" type="button" class="btn-secondary">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
    modal.querySelector('#delete-profile-cancel-btn').onclick = () => modal.remove();
    
    let mouseDownOnModal = false;
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
            mouseDownOnModal = true;
        } else {
            mouseDownOnModal = false;
        }
    });

    modal.addEventListener('mouseup', (e) => {
        if (e.target === modal && mouseDownOnModal) {
            modal.remove();
        }
        mouseDownOnModal = false;
    });
    
    // Delete confirmation
    modal.querySelector('#delete-profile-confirm-btn').onclick = () => {
        modal.remove();
        onConfirm();
    };
    
    setupModalEscapeKey(modal);
}

function setupExpandableSection(headerId, arrowId, sectionId, useSettings = true) {
    const header = document.getElementById(headerId);
    const arrow = document.getElementById(arrowId);
    const section = document.getElementById(sectionId);
    
    if (!header || !arrow || !section) {
        console.log(`Missing elements: ${headerId}, ${arrowId}, ${sectionId}`);
        return;
    }
    
    header.onclick = () => {
        const isExpanded = section.classList.contains('expanded');
        
        if (isExpanded) {
            section.classList.remove('expanded');
            arrow.textContent = '▸';
        } else {
            section.classList.add('expanded');
            arrow.textContent = '▾';
        }
    };
    
    // Determine default state
    let shouldExpand = false;
    
    if (useSettings) {
        initializeSettings();
        
        // Map section IDs to settings
        const sectionSettingsMap = {
            'cover-section': 'coverExpandedByDefault',
            'links-section': 'linksExpandedByDefault', 
            'note-section': 'noteExpandedByDefault',
            'tags-section': 'tagsExpandedByDefault'
        };
        
        const settingKey = sectionSettingsMap[sectionId];
        if (settingKey && data.settings && data.settings[settingKey]) {
            shouldExpand = true;
        }
        
        console.log(`Section ${sectionId}: setting=${settingKey}, value=${data.settings[settingKey]}, shouldExpand=${shouldExpand}`);
    }
    
    // Apply the default state
    if (shouldExpand) {
        section.classList.add('expanded');
        arrow.textContent = '▾';
    } else {
        section.classList.remove('expanded');
        arrow.textContent = '▸';
    }
}

function setupModalEscapeKey(modal) {
  const handleEscKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.remove();
      cleanup();
    }
  };
  const cleanup = () => {
    document.removeEventListener('keydown', handleEscKey);
  };

  document.addEventListener('keydown', handleEscKey);

  // cleanup when closed via close button
  modal.querySelector('.close-btn')?.addEventListener('click', cleanup);

  // cleanup when clicking overlay
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cleanup();
  });
}

// =-=-=-=-=-=-=-=-=-=-=
// FILE & MEDIA HANDLING
// =-=-=-=-=-=-=-=-=-=-=
function createEmptyJsonData() {
    return {
        name: "Root",
        cover: "",
        folders: [],
        entries: [],
        settings: {
            defaultFolderAspectRatio: '8:3',
            defaultFolderColor: '#28a745',
            defaultEntryAspectRatio: '8:3',
            defaultEntryColor: '#6c757d',
            defaultFolderWhiteText: false,
            linksExpandedByDefault: true,
            noteExpandedByDefault: true,
            tagsExpandedByDefault: false,
            entryClickAction: 'openLinks'
        }
    };
}

function handleImageUpload(inputId, targetType = null, targetIndex = null, suggestedName = '') {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    
    fileInput.addEventListener('change', async function(e) {
        const file = e.target.files[0];
        if (file) {
            if (!isValidImageFile(file)) {
                showErrorMessage('Please select a valid image file (JPG, PNG, GIF, WebP, SVG, BMP)', 2);
                return;
            }
            
            try {
                // Convert file to base64
                const reader = new FileReader();
                reader.onload = async function(e) {
                    const base64Data = e.target.result;
                    
                    // Use suggested name or file name
                    const nameToUse = suggestedName || file.name.replace(/\.[^/.]+$/, "");
                    
                    // Save image to server
                    const response = await fetch('/save-image', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            imageData: base64Data,
                            suggestedName: nameToUse
                        })
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        const imagePath = result.path;
                        
                        // Update the input field or directly set the cover
                        if (inputId) {
                            const input = document.getElementById(inputId);
                            if (input) {
                                input.value = imagePath;
                            }
                        }
                        
                        if (targetType && targetIndex !== null) {
                            setCoverImage(targetType, targetIndex, imagePath);
                        }
                        
                        showErrorMessage(`Image saved as "${result.filename}" successfully!`, 1);
                    } else {
                        const error = await response.json();
                        showErrorMessage('Failed to save image: ' + (error.error || 'Unknown error'), 2);
                    }
                };
                reader.readAsDataURL(file);
            } catch (error) {
                showErrorMessage('Error processing image file', 2);
                console.error('Image upload error:', error);
            }
        }
    });
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

async function handlePasteUrl(inputId) {
    try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            showErrorMessage('Clipboard is empty', 1);
            return;
        }
        
        if (!isValidUrl(text.trim())) {
            showErrorMessage('Invalid URL in clipboard. Please copy a valid URL starting with http://, https://, or file://', 2);
            return;
        }
        
        const input = document.getElementById(inputId);
        if (input) {
            input.value = text.trim();
            showErrorMessage('URL pasted successfully!', 1);
        }
    } catch (error) {
        showErrorMessage('Cannot access clipboard. Please paste manually or check browser permissions.', 2);
    }
}

function getDisplayableImageSource(imageSource) {
    if (!imageSource) {
        return '';
    }
    
    // Handle local IMG folder images
    if (imageSource.startsWith('./IMG/')) {
        const filename = imageSource.split('/').pop();
        return filename;
    }
    
    // Handle file:// URLs
    if (imageSource.startsWith('file://')) {
        const parts = imageSource.split('/');
        return parts[parts.length - 1];
    }
    
    // Return as-is for other formats
    return imageSource;
}

function isImageSourceAccessible(imageSource) {
    if (!imageSource) return false;
    
    // Local file references need special handling
    if (imageSource.startsWith('local-file://')) {
        return false; // Cannot directly display local file references
    }
    
    // Blob URLs are temporary
    if (imageSource.startsWith('blob:')) {
        return true; // Blob URLs work temporarily
    }
    
    // HTTP/HTTPS URLs should work
    if (imageSource.startsWith('http')) {
        return true;
    }
    
    // File:// URLs work in some browsers
    if (imageSource.startsWith('file://')) {
        return true;
    }
    
    return false;
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// CHANGELOG & CHANGELOG CONTROL
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
async function fetchChangelogOnStartup() {
    try {
        const response = await fetch('/fetch-changelog');
        if (response.ok) {
            const result = await response.json();
            changelogData = result.data;
            
            // Only show notification if current version is outdated
            if (result.new_release && isNewerVersionAvailable()) {
                setTimeout(() => {
                    showSpecialNotification('📢 New version detected! Head to the changelog section to view what the new version has to offer.');
                }, 2000); // Show after 2 seconds to avoid overwhelming startup
            }
        }
    } catch (error) {
        console.log('Failed to fetch changelog data:', error);
    }
}

async function loadChangelogContent() {
    const contentDiv = document.getElementById('changelog-content');
    
    try {
        let releases = changelogData;
        
        // If no cached data, try to fetch
        if (!releases) {
            const response = await fetch('/fetch-changelog');
            if (response.ok) {
                const result = await response.json();
                releases = result.data;
                changelogData = releases;
            } else {
                throw new Error('Failed to fetch changelog');
            }
        }
        
        if (!releases || releases.length === 0) {
            contentDiv.innerHTML = '<div class="changelog-error">No changelog data available.</div>';
            return;
        }
        
        // Generate changelog HTML
        let changelogHTML = '';
        releases.forEach((release, index) => {
            const publishedDate = new Date(release.published_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            // Convert markdown body to HTML
            const markdownBody = convertMarkdownToHTML(release.body || 'No release notes available.');
            
            changelogHTML += `
                <div class="changelog-release">
                    <div class="changelog-release-header">
                        <h3 class="changelog-release-title">${release.name || release.tag_name}</h3>
                        <span class="changelog-release-date">${publishedDate}</span>
                    </div>
                    <div class="changelog-release-body">${markdownBody}</div>
                </div>
            `;
        });
        
        contentDiv.innerHTML = changelogHTML;
        
    } catch (error) {
        console.error('Error loading changelog:', error);
        contentDiv.innerHTML = '<div class="changelog-error">Failed to load changelog data.</div>';
    }
}

function convertMarkdownToHTML(markdown) {
    // Basic markdown to HTML conversion
    let html = markdown;
    
    // Handle code blocks first to protect them
    const codeBlocks = [];
    html = html.replace(/```[\s\S]*?```/gim, (match, offset) => {
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        codeBlocks.push(match.replace(/```/g, '').trim());
        return placeholder;
    });
    
    // Inline code
    html = html.replace(/`(.*?)`/gim, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    
    // Italic (but not for bullet points)
    html = html.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/gim, '<em>$1</em>');
    
    // Split into sections by double line breaks
    html = html.replace(/\r\n/g, '\n');
    const sections = html.split(/\n\s*\n/);
    
    html = sections.map(section => {
        const lines = section.split('\n').map(line => line.trim()).filter(line => line !== '');
        
        if (lines.length === 0) return '';
        
        // Check if this section contains bullet points
        const bulletLines = lines.filter(line => /^[*-] /.test(line));
        
        if (bulletLines.length > 0 && bulletLines.length === lines.length) {
            // This section is entirely bullet points
            const listItems = bulletLines.map(line => {
                let content = line.replace(/^[*-] /, '');
                // Process links within bullet point content
                content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
                content = content.replace(/(https?:\/\/[^\s<)]+)/gim, '<a href="$1" target="_blank">$1</a>');
                return `<li>${content}</li>`;
            });
            return `<ul>${listItems.join('')}</ul>`;
        } else if (bulletLines.length > 0) {
            // This section has mixed content - process line by line
            let result = '';
            let inList = false;
            let listItems = [];
            
            for (let line of lines) {
                if (/^[*-] /.test(line)) {
                    if (!inList) {
                        inList = true;
                        listItems = [];
                    }
                    let content = line.replace(/^[*-] /, '');
                    // Process links within bullet point content
                    content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
                    content = content.replace(/(https?:\/\/[^\s<)]+)/gim, '<a href="$1" target="_blank">$1</a>');
                    listItems.push(`<li>${content}</li>`);
                } else {
                    if (inList) {
                        result += `<ul>${listItems.join('')}</ul>`;
                        inList = false;
                        listItems = [];
                    }
                    
                    // Process links for non-bullet lines
                    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
                    line = line.replace(/(https?:\/\/[^\s<)]+)/gim, '<a href="$1" target="_blank">$1</a>');
                    
                    // Check if it's a header
                    if (line.includes('<h1>') || line.includes('<h2>') || line.includes('<h3>')) {
                        result += line;
                    } else {
                        result += `<p>${line}</p>`;
                    }
                }
            }
            
            // Close any remaining list
            if (inList) {
                result += `<ul>${listItems.join('')}</ul>`;
            }
            
            return result;
        } else {
            // No bullet points in this section - process links for regular content
            if (lines.length === 1) {
                let line = lines[0];
                line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
                line = line.replace(/(https?:\/\/[^\s<)]+)/gim, '<a href="$1" target="_blank">$1</a>');
                
                // Check if it's already a header
                if (line.includes('<h1>') || line.includes('<h2>') || line.includes('<h3>')) {
                    return line;
                } else {
                    return `<p>${line}</p>`;
                }
            } else {
                const processedLines = lines.map(line => {
                    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>');
                    line = line.replace(/(https?:\/\/[^\s<)]+)/gim, '<a href="$1" target="_blank">$1</a>');
                    return line;
                });
                return `<p>${processedLines.join('<br>')}</p>`;
            }
        }
    }).filter(section => section !== '').join('');
    
    // Restore code blocks
    codeBlocks.forEach((code, index) => {
        html = html.replace(`__CODEBLOCK_${index}__`, `<pre><code>${code}</code></pre>`);
    });
    
    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    
    return html;
}

function parseVersion(versionString) {
    const match = versionString.match(/V(\d+)\.(\d+)/i);
    if (match) {
        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2])
        };
    }
    return null;
}

function compareVersions(version1, version2) {
    const v1 = parseVersion(version1);
    const v2 = parseVersion(version2);
    
    if (!v1 || !v2) return 0;
    
    if (v1.major > v2.major) return 1;
    if (v1.major < v2.major) return -1;
    if (v1.minor > v2.minor) return 1;
    if (v1.minor < v2.minor) return -1;
    return 0;
}

function getLatestVersion(releases) {
    if (!releases || releases.length === 0) return null;
    
    let latestVersion = null;
    let latestVersionString = null;
    
    for (const release of releases) {
        const versionMatch = release.name ? release.name.match(/V\d+\.\d+/i) : null;
        if (versionMatch) {
            const versionString = versionMatch[0];
            if (!latestVersionString || compareVersions(versionString, latestVersionString) > 0) {
                latestVersion = release;
                latestVersionString = versionString;
            }
        }
    }
    
    return { release: latestVersion, version: latestVersionString };
}

function isNewerVersionAvailable() {
    if (!changelogData || changelogData.length === 0) return false;
    
    const latest = getLatestVersion(changelogData);
    if (!latest || !latest.version) return false;
    
    return compareVersions(latest.version, APP_VERSION) > 0;
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=
// VALIDATION & ERROR HANDLING
// =-=-=-=-=-=-=-=-=-=-=-=-=-=
function isValidHexColor(color) {
    return /^#[0-9A-F]{6}$/i.test(color);
}

function isValidImageUrl(url) {
    if (!url) return true; // Empty URL is valid
    
    // Block all web URLs for images
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return false;
    }
    
    // Normalize path separators and check if it's a local IMG path
    const normalizedUrl = url.replace(/\\/g, '/');
    if (normalizedUrl.startsWith('./IMG/')) return true;
    
    // Check if it's a file:// URL
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'file:';
    } catch {
        return false;
    }
}

function isValidLinkUrl(url) {
    if (!url) return true; // Empty URL is valid (will be filtered out)
    
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:' || urlObj.protocol === 'file:';
    } catch {
        return false;
    }
}

function isValidImageFile(file) {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
    return validTypes.includes(file.type);
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function isUrl(string) {
    try {
        new URL(string);
        return true;
    } catch {
        return false;
    }
}

function isImageUrl(url) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const lowerUrl = url.toLowerCase();
    return imageExtensions.some(ext => lowerUrl.includes(ext)) || 
           lowerUrl.includes('image') || 
           lowerUrl.includes('imgur') ||
           lowerUrl.includes('cdn');
}

function isImageFile(file) {
    return file && file.type && file.type.startsWith('image/');
}

function validateTagInput(tagInput) {
    if (!tagInput || !tagInput.trim()) {
        return { valid: true, tags: [] };
    }
    
    // Check for proper semicolon usage
    const trimmedInput = tagInput.trim();
    
    // Parse tags
    const tags = parseTagsFromInput(trimmedInput);
    
    // Validate each tag
    for (let tag of tags) {
        if (tag.length === 0) {
            return { 
                valid: false, 
                error: 'Empty tags are not allowed. Remove extra semicolons or add content between them.' 
            };
        }
        if (tag.length > 50) {
            return { 
                valid: false, 
                error: `Tag "${tag}" is too long. Maximum length is 50 characters.` 
            };
        }
    }
    
    return { valid: true, tags: tags };
}

function isValidPath(path) {
    if (!Array.isArray(path)) return false;
    
    // Check if path exists by traversing the folder structure
    let currentFolder = data;
    
    try {
        for (let folderIndex of path) {
            if (!currentFolder.folders || 
                folderIndex < 0 || 
                folderIndex >= currentFolder.folders.length) {
                return false;
            }
            currentFolder = currentFolder.folders[folderIndex];
        }
        return true;
    } catch (error) {
        return false;
    }
}

function showSpecialNotification(text) {
    initNotificationContainer();
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message info persistent';
    
    errorDiv.innerHTML = `
        <div class="error-message-icon">🔔</div>
        <div class="error-message-text">${text}</div>
    `;
    
    notificationContainer.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.classList.add('show');
    }, 100);
    
    // Remove excess notifications from top (but keep this special one)
    const existingMessages = notificationContainer.querySelectorAll('.error-message:not(.persistent)');
    if (existingMessages.length > MAX_NOTIFICATIONS - 1) {
        const toRemove = existingMessages.length - (MAX_NOTIFICATIONS - 1);
        for (let i = 0; i < toRemove; i++) {
            removeErrorMessage(existingMessages[i]);
        }
    }
    
    // Only remove on click (no auto-remove)
    errorDiv.addEventListener('click', () => {
        removeErrorMessage(errorDiv);
    });
}

function showErrorMessage(text, level = 1) {
    initNotificationContainer();
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    
    let icon, className;
    switch(level) {
        case 1: // Info/Success - need to determine if it's backend success or general info
            // Backend success messages (things that happened/were saved)
            if (text.includes('loaded') || text.includes('saved') || text.includes('updated') || 
                text.includes('created') || text.includes('moved') || text.includes('duplicated') || 
                text.includes('exported') || text.includes('imported') || text.includes('deleted') || 
                text.includes('successfully') || text.includes('referenced') || text.includes('pasted')) {
                
                className = 'success';
                
                // Custom icons based on message content
                if (text.includes('loaded')) icon = '📥';
                else if (text.includes('saved') || text.includes('Save')) icon = '💾';
                else if (text.includes('updated') || text.includes('changed')) icon = '✏️';
                else if (text.includes('created') || text.includes('New')) icon = '✨';
                else if (text.includes('moved') || text.includes('Move')) icon = '📁';
                else if (text.includes('duplicated') || text.includes('Duplicate')) icon = '📄';
                else if (text.includes('exported')) icon = '📤';
                else if (text.includes('imported')) icon = '📥';
                else if (text.includes('deleted') || text.includes('removed')) icon = '🗑️';
                else if (text.includes('referenced') || text.includes('file')) icon = '📎';
                else if (text.includes('pasted') || text.includes('URL')) icon = '📋';
                else icon = '★';
            } else {
                // General info messages stay blue
                icon = 'ℹ️';
                className = 'info';
            }
            break;
        case 2: // Error
            icon = '✖️';
            className = 'error';
            break;
        case 3: // Critical
            icon = '🚨';
            className = 'critical';
            break;
        default:
            icon = 'ℹ️';
            className = 'info';
    }
    
    errorDiv.classList.add(className);
    errorDiv.innerHTML = `
        <div class="error-message-icon">${icon}</div>
        <div class="error-message-text">${text}</div>
    `;
    
    // Add to container (newest at bottom)
    notificationContainer.appendChild(errorDiv);
    
    // Animate in from bottom
    setTimeout(() => {
        errorDiv.classList.add('show');
    }, 100);
    
    // Remove excess notifications from top
    const existingMessages = notificationContainer.querySelectorAll('.error-message');
    if (existingMessages.length > MAX_NOTIFICATIONS) {
        const toRemove = existingMessages.length - MAX_NOTIFICATIONS;
        for (let i = 0; i < toRemove; i++) {
            removeErrorMessage(existingMessages[i]);
        }
    }
    
    // Auto-remove after 10 seconds
    const autoRemoveTimeout = setTimeout(() => {
        removeErrorMessage(errorDiv);
    }, 10000);
    
    // Click to remove
    errorDiv.addEventListener('click', () => {
        clearTimeout(autoRemoveTimeout);
        removeErrorMessage(errorDiv);
    });
}

function removeErrorMessage(errorDiv) {
    if (!errorDiv.parentNode) return;
    
    errorDiv.classList.remove('show');
    errorDiv.classList.add('removing');
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 300);
}