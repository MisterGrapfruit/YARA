import { getAccessToken } from '../auth/googleAuth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function getAuthHeaders() {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Google access token is required for Drive API calls.');
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'omit',
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Drive API error ${response.status}: ${message}`);
  }

  return response.json();
}

async function createFolder(name, parentId) {
  const body = JSON.stringify({
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : []
  });

  return requestJson(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body
  });
}

async function findOrCreateAppFolder(appFolderName) {
  const query = `name='${appFolderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`;
  const response = await requestJson(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`);

  if (response.files && response.files.length > 0) {
    return response.files[0];
  }

  return createFolder(appFolderName);
}

async function findOrCreateChildFolder(name, parentId) {
  const query = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`;
  const response = await requestJson(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)`);

  if (response.files && response.files.length > 0) {
    return response.files[0];
  }

  return createFolder(name, parentId);
}

function createMultipartBody(metadata, content) {
  const boundary = '-------314159265358979323846';
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push('Content-Type: application/json; charset=UTF-8\r\n\r\n');
  parts.push(JSON.stringify(metadata));
  parts.push('\r\n');
  parts.push(`--${boundary}\r\n`);
  parts.push('Content-Type: application/json\r\n\r\n');
  parts.push(typeof content === 'string' ? content : JSON.stringify(content));
  parts.push('\r\n');
  parts.push(`--${boundary}--`);

  return { body: new Blob(parts), boundary };
}

async function uploadJsonFile(metadata, content, method = 'POST', fileId = null) {
  const { body, boundary } = createMultipartBody(metadata, content);
  const url = fileId
    ? `${DRIVE_UPLOAD}/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD}?uploadType=multipart`;

  const response = await fetch(url, {
    method,
    headers: {
      ...getAuthHeaders(),
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Drive upload failed ${response.status}: ${message}`);
  }

  return response.json();
}

export async function createOrUpdateItemFile(item, parentFolderId, prefix) {
  const name = `${prefix}-${item.id}.json`;
  const metadata = {
    name,
    mimeType: 'application/json',
    parents: [parentFolderId]
  };
  const content = JSON.stringify(item, null, 2);

  if (item.driveFileId) {
    return uploadJsonFile(metadata, content, 'PATCH', item.driveFileId);
  }

  return uploadJsonFile(metadata, content, 'POST');
}

export async function syncRecipesToDrive(state, appFolderName = 'YARA Recipes') {
  const appFolder = await findOrCreateAppFolder(appFolderName);
  const recipesFolder = await findOrCreateChildFolder('Recipes', appFolder.id);
  const ingredientsFolder = await findOrCreateChildFolder('Ingredients', appFolder.id);
  const measurementsFolder = await findOrCreateChildFolder('Measurements', appFolder.id);

  const folderMap = new Map();
  const folders = [...state.folders];

  for (const folder of folders) {
    if (!folder.driveFolderId) {
      const created = await createFolder(folder.name, recipesFolder.id);
      folder.driveFolderId = created.id;
    }
    folderMap.set(folder.id, folder.driveFolderId);
  }

  const ingredients = [];
  for (const ingredient of state.ingredients) {
    const createdFile = await createOrUpdateItemFile(ingredient, ingredientsFolder.id, 'ingredient');
    ingredients.push({ ...ingredient, driveFileId: createdFile.id });
  }

  const measurements = [];
  for (const measurement of state.measurements) {
    const createdFile = await createOrUpdateItemFile(measurement, measurementsFolder.id, 'measurement');
    measurements.push({ ...measurement, driveFileId: createdFile.id });
  }

  const recipes = [];
  for (const recipe of state.recipes) {
    const parentFolderId = recipe.folderId ? folderMap.get(recipe.folderId) || recipesFolder.id : recipesFolder.id;
    const createdFile = await createOrUpdateItemFile(recipe, parentFolderId, 'recipe');
    recipes.push({ ...recipe, driveFileId: createdFile.id });
  }

  return {
    driveFolders: {
      root: appFolder.id,
      recipes: recipesFolder.id,
      ingredients: ingredientsFolder.id,
      measurements: measurementsFolder.id
    },
    folders,
    recipes,
    ingredients,
    measurements
  };
}
