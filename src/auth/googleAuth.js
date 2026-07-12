const STORAGE_KEY = 'recipe-app-google-auth';
const PKCE_VERIFIER_KEY = 'recipe-app-google-pkce-verifier';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return hashBuffer;
}

function createCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function createCodeChallenge(verifier) {
  const hashed = await sha256(verifier);
  return base64UrlEncode(hashed);
}

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(params.entries());
}

function clearQueryParams() {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, document.title, url.toString());
}

function parseJwt(token) {
  const payload = token.split('.')[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const json = decodeURIComponent(
    decoded
      .split('')
      .map((c) => `%${('00' + c.charCodeAt(0).toString(16)).slice(-2)}`)
      .join('')
  );
  return JSON.parse(json);
}

function getStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Unable to read auth state', error);
    return null;
  }
}

function saveAuth(authState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(authState));
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PKCE_VERIFIER_KEY);
}

export async function signIn(clientId, redirectUri, scope = '') {
  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  window.location.assign(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}

async function exchangeCodeForToken(code, clientId, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorBody}`);
  }

  const payload = await response.json();
  const idTokenClaims = payload.id_token ? parseJwt(payload.id_token) : null;
  return { ...payload, idTokenClaims };
}

export async function handleRedirectCallback(clientId, redirectUri) {
  const params = getQueryParams();
  if (!params.code) {
    return getStoredAuth();
  }

  const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) {
    throw new Error('Missing PKCE verifier for Google OAuth exchange.');
  }

  const authState = await exchangeCodeForToken(params.code, clientId, redirectUri, codeVerifier);
  saveAuth(authState);
  clearQueryParams();
  return authState;
}

export function getAccessToken() {
  const auth = getStoredAuth();
  return auth?.access_token ?? null;
}

export function getIdTokenClaims() {
  const auth = getStoredAuth();
  return auth?.idTokenClaims ?? null;
}

export function signOut() {
  clearAuth();
}
