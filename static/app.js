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

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-
// CORE DATA & STATE MANAGEMENT
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-
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

function deepCloneItem(item) {
    return JSON.parse(JSON.stringify(item));
}

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
        globalSettings.activeSession = profileName;
        await saveGlobalSettings();
        await loadCurrentSession();
    }
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
            entryClickAction: 'openLinks' // 'openLinks' or 'copyNote'
        };
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

async function initializeGlobalSettings() {
    try {
        const response = await fetch('/load-global-settings');
        if (response.ok) {
            const serverGlobalSettings = await response.json();
            globalSettings = serverGlobalSettings;
        } else {
            // Create default global settings file
            await createDefaultGlobalSettings();
        }
    } catch (error) {
        console.log('Creating default global settings file');
        await createDefaultGlobalSettings();
    }
}

async function createDefaultGlobalSettings() {
    globalSettings = {
        activeSession: "profile1",
        profiles: [
            { name: "profile1", value: "./data.json" }
        ]
    };
    await saveGlobalSettings();
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
                    <button id="save-name-btn" type="button" class="btn-primary">Save Name</button>
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

// =-=-=-=-=-=-=-=-=-=-=-=-=
// NAVIGATION & UI RENDERING
// =-=-=-=-=-=-=-=-=-=-=-=-=
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
            <img src="/static/images/folder.png" alt="Cover" title="Default folder icon">
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
            <img src="/static/images/entry.png" alt="Cover" title="Default entry icon">
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

    // Left side - Path label, separator, and path buttons
    const pathBarLeft = document.createElement('div');
    pathBarLeft.className = 'path-bar-left';

    // Path label
    const pathLabel = document.createElement('div');
    pathLabel.className = 'path-label';
    pathLabel.textContent = 'Path';
    pathBarLeft.appendChild(pathLabel);

    // Main separator
    const mainSeparator = document.createElement('div');
    mainSeparator.className = 'path-separator-main';
    pathBarLeft.appendChild(mainSeparator);

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

    pathBarLeft.appendChild(pathButtons);

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
    
    if (historyItem && historyItem.type === 'search') {
        currentPath = [...historyItem.path];
        const searchInput = document.getElementById('search-input');
        searchInput.value = historyItem.searchTerm;
        executeSearch(historyItem.searchTerm);
    } else {
        currentPath = [...(historyItem || [])];
        clearSearch();
        clearSelection();
        render();
    }
}

function navigateForward() {
    if (historyIndex >= navigationHistory.length - 1) {
        showErrorMessage('No next location in history', 1);
        return;
    }
    
    historyIndex++;
    const historyItem = navigationHistory[historyIndex];
    
    if (historyItem && historyItem.type === 'search') {
        currentPath = [...historyItem.path];
        const searchInput = document.getElementById('search-input');
        searchInput.value = historyItem.searchTerm;
        executeSearch(historyItem.searchTerm);
    } else {
        currentPath = [...(historyItem || [])];
        clearSearch();
        clearSelection();
        render();
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

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// CONTENT CREATION & MODIFICATION
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
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
    const newName = modal.querySelector('#folder-name').value.trim();
    const newColor = modal.querySelector('#folder-color-hex').value.trim();
    const newCover = modal.querySelector('#folder-cover').value.trim();
    const newAspectRatio = modal.querySelector('#folder-aspect-ratio-select').value.trim();
    const whiteTextBtn = modal.querySelector('#white-text-btn');
    const newWhiteText = whiteTextBtn ? whiteTextBtn.classList.contains('active') : false;
    const newTagsInput = modal.querySelector('#folder-tags').value.trim();
    
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
        showErrorMessage('Invalid cover image URL. Please use a valid URL starting with http://, https://, file://, or leave empty', 2);
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
    targetFolder.cover = newCover;
    targetFolder.aspectRatio = newAspectRatio;
    targetFolder.whiteText = newWhiteText;
    targetFolder.folderTags = tagValidation.tags;
    
    autoSave();
    render();
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
    const newName = modal.querySelector('#entry-name').value.trim();
    const newColor = modal.querySelector('#entry-color-hex').value.trim();
    const newCover = modal.querySelector('#entry-cover').value.trim();
    const newAspectRatio = modal.querySelector('#entry-aspect-ratio-select').value.trim();
    const newNote = modal.querySelector('#entry-note').value.trim();
    const newTagsInput = modal.querySelector('#entry-tags').value.trim();
    
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
        showErrorMessage('Invalid cover image URL. Please use a valid URL starting with http://, https://, file://, or leave empty', 2);
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
    targetEntry.cover = newCover;
    targetEntry.aspectRatio = newAspectRatio;
    targetEntry.links = newLinks;
    targetEntry.note = newNote;
    targetEntry.entryTags = tagValidation.tags;
    
    autoSave();
    render();
    modal.remove();
    
    if (changes.length > 0) {
        showErrorMessage(`Entry updated successfully! Changed: ${changes.join(', ')}`, 1);
    } else {
        showErrorMessage('No changes detected', 1);
    }
}

function deleteFolderWithConfirmation(folderIdx, modal) {
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
        modal.remove();
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
        render();
        modal.remove();
        showErrorMessage(`Entry "${targetEntry.name}" deleted successfully`, 1);
    });
}

function setCoverImage(targetType, targetIndex, imageSource) {
    const folder = getCurrentFolder();
    
    let finalImageSource = imageSource;
    let messageText = '';
    
    // Handle different types of image sources
    if (imageSource.startsWith('blob:')) {
        // For blob URLs, warn user and suggest alternatives
        finalImageSource = imageSource;
        messageText = 'Warning: Uploaded image will only work in current session. Consider using image URLs for permanent storage.';
    } else if (imageSource.startsWith('local-file://')) {
        // Local file reference with metadata
        finalImageSource = imageSource;
        const fileName = getDisplayableImageSource(imageSource);
        messageText = `Local file "${fileName}" referenced. Ensure file stays in same location.`;
    } else if (imageSource.startsWith('file://')) {
        // Direct file:// URLs
        finalImageSource = imageSource;
        messageText = 'Local file path saved.';
    } else if (imageSource.startsWith('http')) {
        // Web URLs
        finalImageSource = imageSource;
        messageText = 'Web image URL saved.';
    } else {
        // Unknown format
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

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// BATCH OPERATIONS & INTERACTIONS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
function createBatchActionsBar() {
    const bar = document.createElement('div');
    bar.className = 'batch-actions-bar';
    bar.id = 'batch-actions-bar';
    
    bar.innerHTML = `
        <div class="batch-actions">
            <button id="batch-delete-btn" class="batch-delete-btn" data-tooltip="Delete">🗑️</button>
            <button id="batch-export-btn" class="batch-export-btn" data-tooltip="Export as JSON">📤</button>
            <button id="batch-duplicate-btn" class="batch-duplicate-btn" data-tooltip="Duplicate">📄</button>
            <button id="batch-open-btn" class="batch-open-btn" data-tooltip="Open">🚀</button>
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

function toggleSelectionMode() {
    selectionMode = !selectionMode;
    const btn = document.getElementById('selection-toggle-btn');
    const pathBar = document.querySelector('.path-bar');
    const batchBar = document.getElementById('batch-actions-bar');
    
    if (selectionMode) {
        btn.textContent = '✗ Cancel';
        btn.classList.add('active');
    } else {
        btn.textContent = '✓ Select';
        btn.classList.remove('active');
        clearSelection();
    }
    
    render();
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
    const folder = getCurrentFolder();
    
    folder.folders.forEach((_, idx) => {
        selectedItems.add(`folder:${idx}`);
    });
    
    folder.entries.forEach((_, idx) => {
        selectedItems.add(`entry:${idx}`);
    });
    
    render();
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
    return true;
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
    });
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

        // Handle image files - placeholder functionality
        const imageFiles = files.filter(file => isImageFile(file));
        imageFiles.forEach(file => {
            const fileName = file.name;
            const newEntryName = `Image: ${fileName}`;
            createNewEntry(newEntryName, '', []);
            showErrorMessage('Image functionality will be implemented in a future update. Entry created without cover.', 1);
        });

        // Handle URLs
        if (urls.length > 0) {
            urls.forEach(url => {
                if (url.trim()) {
                    if (isImageUrl(url)) {
                        // Image URL - create new entry with placeholder
                        const newEntryName = `Image from ${extractDomainFromUrl(url)}`;
                        createNewEntry(newEntryName, '', [url]);
                        showErrorMessage('Image functionality will be implemented in a future update. Entry created without cover.', 1);
                    } else {
                        // Regular link - create new entry with link
                        createNewEntry(`Link from ${extractDomainFromUrl(url)}`, '', [url]);
                    }
                }
            });
        } else if (textData && isUrl(textData)) {
            if (isImageUrl(textData)) {
                // Image URL - create new entry with placeholder
                const newEntryName = `Image from ${extractDomainFromUrl(textData)}`;
                createNewEntry(newEntryName, '', [textData]);
                showErrorMessage('Image functionality will be implemented in a future update. Entry created without cover.', 1);
            } else {
                // Regular link - create new entry with link
                createNewEntry(`Link from ${extractDomainFromUrl(textData)}`, '', [textData]);
            }
        }
    });
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
                filePath = `./imported_${Date.now()}_${jsonFile.name}`;
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

        // Handle image files - set as folder/entry cover
        const imageFiles = files.filter(file => isImageFile(file));
        if (imageFiles.length > 0) {
            const file = imageFiles[0];
            const fileName = file.name;
            const fileSize = Math.round(file.size / 1024);
            const fileType = file.type;
            const customFileReference = `local-file://${fileName}|${fileSize}KB|${fileType}|${Date.now()}`;
            setCoverImage('entry', entryIdx, customFileReference);
        }
        else if (urls.length > 0 && urls.some(url => isImageUrl(url))) { // Handle image URLs - placeholder functionality
            const imageUrl = urls.find(url => isImageUrl(url));
            setCoverImage('folder', folderIdx, imageUrl);
        }
        else if (textData && isImageUrl(textData)) {
            setCoverImage('folder', folderIdx, textData);
        }
        // Handle regular links - create new entry in folder
        else if (urls.length > 0) {
            urls.forEach(url => {
                if (url.trim() && !isImageUrl(url)) {
                    createEntryInFolder(folderIdx, url);
                }
            });
        }
        else if (textData && isUrl(textData) && !isImageUrl(textData)) {
            createEntryInFolder(folderIdx, textData);
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

        // Handle image files - set as folder/entry cover
        const imageFiles = files.filter(file => isImageFile(file));
        if (imageFiles.length > 0) {
            showErrorMessage('Image drag-and-drop functionality will be implemented in a future update. Use the edit menu to set covers.', 1);
        }
        // Handle URLs
        else if (urls.length > 0) {
            // Check for image URLs first
            const imageUrls = urls.filter(url => isImageUrl(url));
            const regularUrls = urls.filter(url => !isImageUrl(url));
    
            // Set first image as cover if entry doesn't have one
            if (imageUrls.length > 0) {
                showErrorMessage('Image URL drag-and-drop functionality will be implemented in a future update. Use the edit menu to set covers.', 1);
                // Add image URLs as links too
                imageUrls.forEach(url => addLinkToEntry(entryIdx, url));
            }
    
            // Add regular URLs as links
            regularUrls.forEach(url => addLinkToEntry(entryIdx, url));
        }
        // Handle single URL from text
        else if (textData && isUrl(textData)) {
            if (isImageUrl(textData)) {
                showErrorMessage('Image URL drag-and-drop functionality will be implemented in a future update. Use the edit menu to set covers.', 1);
                addLinkToEntry(entryIdx, textData);
            } else {
                addLinkToEntry(entryIdx, textData);
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

function extractDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'Unknown';
    }
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// SEARCH & FILTER UTILITIES
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=
function initializeSearchFunctionality() {
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const searchInput = document.getElementById('search-input');
    
    searchToggleBtn.onclick = handleSearchToggle;
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('focus', handleSearchFocus);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    
    document.addEventListener('click', handleSearchOutsideClick);
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
    
    if (results.length === 0) {
        displaySearchResults([], trimmedSearch);
        return;
    }
    
    addSearchToHistory(trimmedSearch);
    displaySearchResults(results, trimmedSearch);
}

function performSearchOperation(searchText, folder, currentFolderPath) {
    const results = [];
    const searchQueries = parseSearchQuery(searchText);
    searchInFolder(folder, currentFolderPath, searchQueries, results);
    return results;
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
    `;
    mainView.appendChild(searchHeader);
    
    const contentWrapper = document.createElement('div');
    contentWrapper.style.padding = '20px';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-container search-results';
    
    const sortedResults = sortSearchResults(results, currentSort);
    
    sortedResults.forEach((result) => {
        const div = document.createElement('div');
        div.className = result.type === 'folder' ? 'folder search-result' : 'entry search-result';
        
        if (result.type === 'folder') {
            const totalEntries = getTotalEntries(result.item);
            div.innerHTML = `
                <img src="/static/images/folder.png" alt="Cover" title="Default folder icon">
                <div class="folder-name">📁 ${result.item.name}</div>
                <div class="folder-count">${totalEntries} entries</div>
                <div class="search-result-path">📍 ${result.pathDisplay}</div>
            `;
        } else {
            const linksCount = getLinksCount(result.item);
            div.innerHTML = `
                <img src="/static/images/entry.png" alt="Cover" title="Default entry icon">
                <div class="entry-title">${result.item.name}</div>
                <div class="entry-links-count">${linksCount} links</div>
                <div class="search-result-path">📍 ${result.pathDisplay}</div>
            `;
        }
        
        div.onclick = () => navigateToSearchResult(result);

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (result.type === 'folder') {
                let parentFolder = data;
                for (let i = 0; i < result.path.length - 1; i++) {
                    parentFolder = parentFolder.folders[result.path[i]];
                }
                const folderIdx = result.path[result.path.length - 1] || result.path.length;
                showFolderEditModal(result.item, folderIdx);
            } else {
                let entryFolder = data;
                for (let i = 0; i < result.path.length; i++) {
                    entryFolder = entryFolder.folders[result.path[i]];
                }
                showEntryEditModal(result.item, result.entryIndex);
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
    
    setTimeout(() => applySearchResultColors(), 0);
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
    
    folders.forEach((folderElement, index) => {
        const folderResults = searchResults.results.filter(r => r.type === 'folder');
        if (folderResults[index]) {
            const result = folderResults[index];
            const color = result.item.color || '#28a745';
            const whiteText = result.item.whiteText || false;
            
            const variations = createColorVariations(color, 'folder');
            folderElement.style.setProperty('--folder-bg-color', variations.gradient);
            folderElement.style.setProperty('--folder-border-color', variations.border);
            
            const folderName = folderElement.querySelector('.folder-name');
            const folderCount = folderElement.querySelector('.folder-count');
            
            if (whiteText) {
                folderName.style.color = 'white';
                folderCount.style.color = '#e0e0e0e0';
            } else {
                folderName.style.color = '#333';
                folderCount.style.color = '#474747ff';
            }
        }
    });
    
    entries.forEach((entryElement, index) => {
        const entryResults = searchResults.results.filter(r => r.type === 'entry');
        if (entryResults[index]) {
            const result = entryResults[index];
            const color = result.item.color || '#6c757d';
            const variations = createColorVariations(color, 'entry');
            entryElement.style.setProperty('--entry-border-color', variations.gradient);
        }
    });
}

function navigateToSearchResult(result) {
    if (result.type === 'folder') {
        navigateToPath(result.path);
    } else {
        navigateToPath(result.path);
    }
    clearSearch();
}

function clearSearch() {
    isSearchActive = false;
    searchResults = null;
    
    if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
    }
    
    render();
}

function addSearchToHistory(searchTerm) {
    const searchState = {
        type: 'search',
        searchTerm: searchTerm,
        path: [...currentPath]
    };
    
    if (historyIndex < navigationHistory.length - 1) {
        navigationHistory = navigationHistory.slice(0, historyIndex + 1);
    }
    
    navigationHistory.push(searchState);
    historyIndex = navigationHistory.length - 1;
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

function formatTagsForDisplay(tags) {
    if (!tags || tags.length === 0) {
        return '';
    }
    return tags.join('; ') + (tags.length > 0 ? ';' : '');
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// MODAL DIALOGS & USER INTERFACE
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
function showFolderEditModal(folder, folderIdx) {
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
                        <input type="url" id="folder-cover" value="${folder.cover || ''}" placeholder="https://example.com/image.jpg">
                        <div class="cover-preview" style="margin-top: 10px;">
                            ${folder.cover ? `<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Current cover: ${getDisplayableImageSource(folder.cover)}</div>` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
                            <button type="button" id="upload-folder-cover-btn" class="btn-secondary">📂 Upload Image</button>
                            <button type="button" id="paste-folder-cover-btn" class="btn-info">📋 Paste URL</button>
                            <div class="aspect-ratio-dropdown">
                                <select id="folder-aspect-ratio-select">
                                    <option value="3:4" ${(folder.aspectRatio || '8:3') === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                    <option value="1:1" ${(folder.aspectRatio || '8:3') === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                    <option value="3:2" ${(folder.aspectRatio || '8:3') === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                    <option value="8:3" ${(folder.aspectRatio || '8:3') === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                </select>
                            </div>
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
    setupExpandableSection('cover-header', 'cover-arrow', 'cover-section', false);
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
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
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

    modal.querySelector('#upload-folder-cover-btn').onclick = () => handleImageUpload('folder-cover');
    modal.querySelector('#paste-folder-cover-btn').onclick = () => handlePasteUrl('folder-cover');
    
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
        modal.remove();
        showErrorMessage('Folder duplicated successfully!', 1);
    };

    modal.querySelector('#delete-folder-btn').onclick = () => {
        deleteFolderWithConfirmation(folderIdx, modal);
    };
    
    setupModalEscapeKey(modal);
}

function showEntryEditModal(entryData, entryIdx) {
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
                        <input type="url" id="entry-cover" value="${actualEntry.cover || ''}" placeholder="https://example.com/image.jpg">
                        <div class="cover-preview" style="margin-top: 10px;">
                            ${actualEntry.cover ? `<div style="font-size: 12px; color: #666; margin-bottom: 5px;">Current cover: ${getDisplayableImageSource(actualEntry.cover)}</div>` : ''}
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 10px; align-items: center;">
                            <button type="button" id="upload-entry-cover-btn" class="btn-secondary">📂 Upload Image</button>
                            <button type="button" id="paste-entry-cover-btn" class="btn-info">📋 Paste URL</button>
                            <div class="aspect-ratio-dropdown">
                                <select id="entry-aspect-ratio-select">
                                    <option value="3:4" ${(actualEntry.aspectRatio || '8:3') === '3:4' ? 'selected' : ''}>3:4 (Portrait)</option>
                                    <option value="1:1" ${(actualEntry.aspectRatio || '8:3') === '1:1' ? 'selected' : ''}>1:1 (Square)</option>
                                    <option value="3:2" ${(actualEntry.aspectRatio || '8:3') === '3:2' ? 'selected' : ''}>3:2 (Photo)</option>
                                    <option value="8:3" ${(actualEntry.aspectRatio || '8:3') === '8:3' ? 'selected' : ''}>8:3 (Ultrawide)</option>
                                </select>
                            </div>
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
    
    setupExpandableSection('cover-header', 'cover-arrow', 'cover-section', false);
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
    
    // Event listeners
    modal.querySelector('.close-btn').onclick = () => modal.remove();
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

    modal.querySelector('#upload-entry-cover-btn').onclick = () => handleImageUpload('entry-cover');
    modal.querySelector('#paste-entry-cover-btn').onclick = () => handlePasteUrl('entry-cover');
    
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
        modal.remove();
        showErrorMessage('Entry duplicated successfully!', 1);
    };
    
    modal.querySelector('#save-entry-btn').onclick = () => {
        saveEntryChanges(modal, entryIdx);
    };
    
    modal.querySelector('#delete-entry-btn').onclick = () => {
        deleteEntryWithConfirmation(entryIdx, modal);
    };
    
    setupModalEscapeKey(modal);
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
                    <div>Right click a Folder/Entry to Edit</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">📁</div>
                    <div>Left click a folder to open it</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">🖱️</div>
                    <div>Drag images/URLs to create entries</div>
                </div>
                <div class="help-item">
                    <div class="help-icon">📋</div>
                    <div>Use Select mode for batch operations</div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.close-btn').onclick = () => modal.remove();
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
                            <label class="settings-label">Links section expanded by default:</label>
                            <div class="settings-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" id="links-expanded-default" ${data.settings.linksExpandedByDefault ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        
                        <div class="settings-form-group">
                            <label class="settings-label">Note section expanded by default:</label>
                            <div class="settings-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" id="note-expanded-default" ${data.settings.noteExpandedByDefault ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="settings-form-group">
                            <label class="settings-label">Tags section expanded by default:</label>
                            <div class="settings-control">
                                <label class="toggle-switch">
                                    <input type="checkbox" id="tags-expanded-default" ${data.settings.tagsExpandedByDefault ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
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
        data.settings.linksExpandedByDefault = modal.querySelector('#links-expanded-default').checked;
        data.settings.noteExpandedByDefault = modal.querySelector('#note-expanded-default').checked;
        data.settings.tagsExpandedByDefault = modal.querySelector('#tags-expanded-default').checked;
        data.settings.entryClickAction = modal.querySelector('#entry-click-action').value;
        
        autoSave();
        modal.remove();
        showErrorMessage('Settings saved successfully!', 1);
    };
    
    setupModalEscapeKey(modal);
}

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
        render();
        modal.remove();
        showErrorMessage(`Folder "${name}" created successfully!`, 1);
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
        render();
        modal.remove();
        showErrorMessage(`Entry "${name}" created successfully!`, 1);
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
    
    // Use settings to determine default state only if useSettings is true
    if (useSettings) {
        initializeSettings();
        let sectionType;
        if (sectionId === 'links-section') {
            sectionType = 'linksExpandedByDefault';
        } else if (sectionId === 'note-section') {
            sectionType = 'noteExpandedByDefault';
        } else if (sectionId === 'tags-section') {
            sectionType = 'tagsExpandedByDefault';
        }

        const shouldExpand = data.settings[sectionType];
        
        if (shouldExpand) {
            section.classList.add('expanded');
            arrow.textContent = '▾';
        } else {
            section.classList.remove('expanded');
            arrow.textContent = '▸';
        }
    } else {
        // For cover and tags sections, default to collapsed
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
// FILE HANDLING & MEDIA
// =-=-=-=-=-=-=-=-=-=-=
function handleImageUpload(inputId) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            if (!isValidImageFile(file)) {
                showErrorMessage('Please select a valid image file (JPG, PNG, GIF, WebP, SVG, BMP)', 2);
                return;
            }
            
            // Try to get the file path information
            const fileName = file.name;
            const fileSize = Math.round(file.size / 1024); // Size in KB
            const fileType = file.type;
            
            // For local files, we'll use a custom format that includes file info
            const customFileReference = `local-file://${fileName}|${fileSize}KB|${fileType}|${Date.now()}`;
            
            const input = document.getElementById(inputId);
            if (input) {
                input.value = customFileReference;
                showErrorMessage(`Local file "${fileName}" referenced successfully! Note: File must remain in same location.`, 1);
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
    
    // Handle local file references
    if (imageSource.startsWith('local-file://')) {
        const parts = imageSource.replace('local-file://', '').split('|');
        return parts[0]; // Return just the filename for display
    }
    
    // Handle blob URLs
    if (imageSource.startsWith('blob:')) {
        return '[Temporary Upload - Use URL instead]';
    }
    
    // Return regular URLs as-is
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

// =-=-=-=-=-=-=-=-=-=-=-=-=-=
// VALIDATION & ERROR HANDLING
// =-=-=-=-=-=-=-=-=-=-=-=-=-=
function isValidHexColor(color) {
    return /^#[0-9A-F]{6}$/i.test(color);
}

function isValidImageUrl(url) {
    if (!url) return true; // Empty URL is valid
    
    // Check if it's a local file reference
    if (url.startsWith('local-file://')) return true;
    
    // Check if it's a valid URL
    try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:' || urlObj.protocol === 'file:';
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
        return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
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

function initNotificationContainer() {
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.className = 'notification-container';
        document.body.appendChild(notificationContainer);
    }
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

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// INITIALIZATION & EVENT HANDLERS 
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize global settings and load current session
    await loadDataFromServer();
    initializeNavigationHistory();
    
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
        render();
    };

    // Initial render
    render();
});
