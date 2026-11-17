package server

import (
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
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
