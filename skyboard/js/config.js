// Skyboard runtime config. Delete or empty functionsBase to fall back to the
// fully-mocked adapter (useful for offline development).
window.Skyboard = window.Skyboard || {};

Skyboard.config = {
  functionsBase: "https://pmgcleqvmzcojupyqhbo.supabase.co/functions/v1",
};
