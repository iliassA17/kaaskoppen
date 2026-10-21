const SANDBOX_PROJECT = 'bs-test-b94c7';

function assertSandboxProject(projectId) {
  const emulator = projectId === 'demo-kaaskoppen' &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' &&
    process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080';
  if (projectId !== SANDBOX_PROJECT && !emulator) {
    throw new Error('Deze testversie werkt uitsluitend met Firebase-project bs-test-b94c7.');
  }
  return projectId;
}

function projectId() {
  return assertSandboxProject(process.env.FIREBASE_PROJECT_ID || SANDBOX_PROJECT);
}
module.exports = {SANDBOX_PROJECT, assertSandboxProject, projectId};
