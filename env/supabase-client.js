// Lightweight wrapper around supabase-js for this project.
//
// Depends on two globals that must be loaded before this script:
//   1. window.SUPABASE_CONFIG  (from env/config.js)
//   2. window.supabase         (from the supabase-js UMD CDN)
//
// Exposes:
//   window.ComicallyLargeDrawings.uploadDrawing(blob, { caption, prompt })
//   window.ComicallyLargeDrawings.listDrawings({ limit } = {})

(function () {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    console.warn("[supabase-client] SUPABASE_CONFIG missing — upload/list disabled.");
    window.ComicallyLargeDrawings = disabledClient("missing config");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.warn("[supabase-client] supabase-js not loaded — upload/list disabled.");
    window.ComicallyLargeDrawings = disabledClient("missing supabase-js");
    return;
  }

  const client = window.supabase.createClient(cfg.url, cfg.anonKey);
  const bucket = cfg.bucket || "drawings";
  const table  = cfg.table  || null;

  async function uploadDrawing(blob, meta = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rand  = Math.random().toString(36).slice(2, 8);
    const objectPath = `${stamp}_${rand}.png`;

    const { error: upErr } = await client.storage
      .from(bucket)
      .upload(objectPath, blob, {
        contentType: "image/png",
        upsert: false,
      });
    if (upErr) {
      console.error("[supabase-client] upload failed:", upErr);
      throw upErr;
    }

    if (table) {
      const row = {
        object_path: objectPath,
        caption: meta.caption ?? null,
        prompt:  meta.prompt  ?? null,
      };
      const { error: insErr } = await client.from(table).insert(row);
      if (insErr) {
        // Don't fail the upload if the metadata row fails — the image is already saved.
        console.warn("[supabase-client] metadata insert failed:", insErr);
      }
    }

    return { objectPath };
  }

  async function listDrawings({ limit = 200 } = {}) {
    // Prefer the metadata table (has captions + ordering). Fall back to bucket list.
    if (table) {
      const { data, error } = await client
        .from(table)
        .select("object_path, caption, prompt, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!error && Array.isArray(data)) {
        return data.map(r => ({
          path:    r.object_path,
          url:     publicUrl(r.object_path),
          caption: r.caption,
          prompt:  r.prompt,
          createdAt: r.created_at,
        }));
      }
      console.warn("[supabase-client] table query failed, falling back to bucket list:", error);
    }

    const { data, error } = await client.storage.from(bucket).list("", {
      limit,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      console.error("[supabase-client] bucket list failed:", error);
      return [];
    }
    return (data || [])
      .filter(obj => obj && obj.name && !obj.name.endsWith("/"))
      .map(obj => ({
        path:    obj.name,
        url:     publicUrl(obj.name),
        caption: null,
        prompt:  null,
        createdAt: obj.created_at || null,
      }));
  }

  function publicUrl(path) {
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || "";
  }

  window.ComicallyLargeDrawings = {
    uploadDrawing,
    listDrawings,
    publicUrl,
    _client: client,
  };

  function disabledClient(reason) {
    return {
      uploadDrawing: async () => { throw new Error("Drawings disabled: " + reason); },
      listDrawings:  async () => [],
      publicUrl:     () => "",
    };
  }
})();
