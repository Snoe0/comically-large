// Supabase configuration (EXAMPLE — copy this file to `config.js` and fill in).
// `config.js` is gitignored so your keys stay local.
//
// The anon/publishable key is safe to ship in client-side code AS LONG AS
// you configure Row Level Security / bucket policies on the Supabase side.
window.SUPABASE_CONFIG = {
  url:        "https://YOUR-PROJECT-REF.supabase.co",
  anonKey:    "YOUR-ANON-OR-PUBLISHABLE-KEY",
  bucket:     "drawings",        // storage bucket that holds PNGs
  table:      "drawings",        // table with row-per-drawing metadata (optional)
};
