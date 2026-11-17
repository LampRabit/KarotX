// Package server exposes the KarotX JSON API and serves the embedded UI.
package server

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/lamprabit/karotx/internal/state"
)

const sessionCookie = "karotx_session"

type Options struct {
	Version  string
	Password string // empty = no auth
	Theme    string // CLI override; empty = use state file
	Store    *state.Store
	UI       fs.FS
}

type Server struct {
	opt      Options
	pwHash   [32]byte
	mu       sync.Mutex
	sessions map[string]time.Time
}

func New(opt Options) http.Handler {
	s := &Server{opt: opt, pwHash: sha256.Sum256([]byte(opt.Password)), sessions: map[string]time.Time{}}

	api := http.NewServeMux()
	api.HandleFunc("GET /api/session", s.session)
	api.HandleFunc("POST /api/login", s.login)
	api.HandleFunc("POST /api/logout", s.logout)
	api.Handle("GET /api/state", s.auth(s.getState))
	api.Handle("PATCH /api/settings", s.auth(s.patchSettings))

	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", spa(opt.UI))
	return mux
}

// --- auth -----------------------------------------------------------------

func (s *Server) authRequired() bool { return s.opt.Password != "" }

func (s *Server) authed(r *http.Request) bool {
	if !s.authRequired() {
		return true
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.sessions[c.Value]
	if !ok || time.Now().After(exp) {
		delete(s.sessions, c.Value)
		return false
	}
	return true
}

func (s *Server) auth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authed(r) {
			writeErr(w, http.StatusUnauthorized, "login required")
			return
		}
		h(w, r)
	})
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"version":       s.opt.Version,
		"authRequired":  s.authRequired(),
		"authenticated": s.authed(r),
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct{ Password string }
	if !readJSON(w, r, &body) {
		return
	}
	got := sha256.Sum256([]byte(body.Password))
	if !s.authRequired() || subtle.ConstantTimeCompare(got[:], s.pwHash[:]) != 1 {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		writeErr(w, http.StatusUnauthorized, "wrong password")
		return
	}
	b := make([]byte, 32)
	rand.Read(b)
	token := hex.EncodeToString(b)
	s.mu.Lock()
	s.sessions[token] = time.Now().Add(30 * 24 * time.Hour)
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 30 * 24 * 3600,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// --- state ----------------------------------------------------------------

func (s *Server) getState(w http.ResponseWriter, r *http.Request) {
	st := s.opt.Store.Get()
	if s.opt.Theme != "" {
		st.Settings.Theme = s.opt.Theme
	}
	writeJSON(w, st)
}

func (s *Server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Theme *string `json:"theme"`
		Mode  *string `json:"mode"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Mode != nil && *body.Mode != "system" && *body.Mode != "light" && *body.Mode != "dark" {
		writeErr(w, http.StatusBadRequest, "mode must be system, light or dark")
		return
	}
	err := s.opt.Store.Update(func(st *state.State) {
		if body.Theme != nil {
			st.Settings.Theme = *body.Theme
		}
		if body.Mode != nil {
			st.Settings.Mode = *body.Mode
		}
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers --------------------------------------------------------------

// spa serves static files and falls back to index.html for client routes.
func spa(ui fs.FS) http.Handler {
	files := http.FileServerFS(ui)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if _, err := fs.Stat(ui, p); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(ui, "index.html")
		if err != nil {
			http.Error(w, "UI not built. Run: pnpm -C web build", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(index)
	})
}

// readJSON decodes a JSON body. Requiring application/json also blocks
// simple cross-site form posts (CSRF).
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		writeErr(w, http.StatusUnsupportedMediaType, "expected application/json")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
