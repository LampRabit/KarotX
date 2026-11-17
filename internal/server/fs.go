package server

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/lamprabit/karotx/internal/driver/sqldb"
)

type fsEntry struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Dir      bool      `json:"dir"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// browseFS lists a folder on the machine running KarotX, so the UI can pick
// files (e.g. SQLite databases) by their real path. Allowed for local
// requests, or remote ones when the UI is password-protected.
func (s *Server) browseFS(w http.ResponseWriter, r *http.Request) {
	if !isLocal(r) && !s.opt.Auth.Enabled() {
		writeErr(w, http.StatusForbidden, "browsing files from another computer requires a password. Set one in Settings → Security")
		return
	}
	dir := r.URL.Query().Get("path")
	if dir == "" {
		dir, _ = os.UserHomeDir()
	}
	dir = filepath.Clean(dir)
	if fi, err := os.Stat(dir); err == nil && !fi.IsDir() {
		dir = filepath.Dir(dir)
	}
	items, err := os.ReadDir(dir)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	entries := []fsEntry{}
	for _, it := range items {
		if strings.HasPrefix(it.Name(), ".") || strings.HasPrefix(it.Name(), "$") {
			continue
		}
		info, err := it.Info()
		if err != nil {
			continue
		}
		entries = append(entries, fsEntry{
			Name: it.Name(), Path: filepath.Join(dir, it.Name()), Dir: it.IsDir(),
			Size: info.Size(), Modified: info.ModTime(),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Dir != entries[j].Dir {
			return entries[i].Dir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	parent := filepath.Dir(dir)
	if parent == dir {
		parent = ""
	}
	home, _ := os.UserHomeDir()
	writeJSON(w, map[string]any{"path": dir, "parent": parent, "home": home, "roots": roots(), "entries": entries})
}

// createSQLite makes a new empty SQLite file in a folder (same access rule as browseFS).
func (s *Server) createSQLite(w http.ResponseWriter, r *http.Request) {
	if !isLocal(r) && !s.opt.Auth.Enabled() {
		writeErr(w, http.StatusForbidden, "creating files from another computer requires a password. Set one in Settings → Security")
		return
	}
	var b struct{ Dir, Name string }
	if !readJSON(w, r, &b) {
		return
	}
	name := strings.TrimSpace(b.Name)
	if name == "" || strings.ContainsAny(name, `/\:*?"<>|`) || name == "." || name == ".." {
		writeErr(w, http.StatusBadRequest, "use a plain file name without slashes or special characters")
		return
	}
	if filepath.Ext(name) == "" {
		name += ".db"
	}
	if fi, err := os.Stat(b.Dir); err != nil || !fi.IsDir() {
		writeErr(w, http.StatusBadRequest, "that folder doesn't exist")
		return
	}
	path := filepath.Join(filepath.Clean(b.Dir), name)
	if err := sqldb.CreateSQLiteFile(path); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]string{"path": path})
}

func roots() []string {
	if runtime.GOOS != "windows" {
		return []string{"/"}
	}
	var out []string
	for c := 'A'; c <= 'Z'; c++ {
		d := string(c) + `:\`
		if _, err := os.Stat(d); err == nil {
			out = append(out, d)
		}
	}
	return out
}
