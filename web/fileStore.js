const fs = require("fs");
const path = require("path");

/**
 * File-based session store para express-session.
 * Guarda cada sesion como un JSON en disco.
 * Elimina el warning de MemoryStore en produccion.
 */
module.exports = function (session) {
  const Store = session.Store;

  class FileStore extends Store {
    constructor(opts = {}) {
      super(opts);
      this.path = opts.path || path.join(__dirname, "../data/sessions");
      this.ttl = opts.ttl || 8 * 60 * 60 * 1000; // 8 horas
      fs.mkdirSync(this.path, { recursive: true });
      // Limpiar sesiones viejas al iniciar
      this._cleanup();
    }

    _file(sid) {
      // Sanitizar sid para evitar path traversal
      const safe = sid.replace(/[^a-zA-Z0-9_-]/g, "_");
      return path.join(this.path, `${safe}.json`);
    }

    get(sid, cb) {
      const file = this._file(sid);
      try {
        if (!fs.existsSync(file)) return cb(null, null);
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.expires && Date.now() > data.expires) {
          this.destroy(sid, () => {});
          return cb(null, null);
        }
        cb(null, data.session);
      } catch {
        cb(null, null);
      }
    }

    set(sid, session, cb) {
      const file = this._file(sid);
      try {
        const expires = Date.now() + this.ttl;
        fs.writeFileSync(file, JSON.stringify({ session, expires }));
        cb && cb(null);
      } catch (e) {
        cb && cb(e);
      }
    }

    destroy(sid, cb) {
      try {
        const file = this._file(sid);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {}
      cb && cb(null);
    }

    _cleanup() {
      try {
        const files = fs.readdirSync(this.path);
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          const file = path.join(this.path, f);
          try {
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (data.expires && Date.now() > data.expires) {
              fs.unlinkSync(file);
            }
          } catch {
            fs.unlinkSync(file);
          }
        }
      } catch {}
    }
  }

  return FileStore;
};
