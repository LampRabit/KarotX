// Package server exposes the KarotX JSON API and serves the embedded UI.
package server

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/lamprabit/karotx/internal/auth"
	"github.com/lamprabit/karotx/internal/state"
)

const sessionCookie = "karotx_session"

type Options struct {
	Version string
	Addr    string // listen address, shown in the UI
	Theme   string // CLI override; empty = use state file
	Store   *state.Store
	Auth    *auth.Manager
	UI      fs.FS
}

type Server struct{ opt Options }

func New(opt Options) http.Handler {
	s := &Server{opt: opt}

	api := http.NewServeMux()
	api.HandleFunc("GET /api/session", s.session)
	api.HandleFunc("POST /api/login", s.login)
	api.HandleFunc("POST /api/logout", s.logout)
	api.Handle("PUT /api/password", s.authed(s.localOnly(s.setPassword)))
	api.Handle("DELETE /api/password", s.authed(s.localOnly(s.removePassword)))
	api.Handle("GET /api/state", s.authed(s.getState))
	api.Handle("PATCH /api/settings", s.authed(s.patchSettings))

	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", spa(opt.UI))
	return mux
}

// --- auth -----------------------------------------------------------------

func token(r *http.Request) string {
	if c, err := r.Cookie(sessionCookie); err == nil {
		return c.Value
	}
	return ""
}

func (s *Server) authed(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.opt.Auth.Valid(token(r)) {
			writeErr(w, http.StatusUnauthorized, "login required")
			return
		}
		h(w, r)
	}
}

// localOnly restricts password management to the machine running KarotX, so
// nobody else on the network can set (or remove) the password first.
func (s *Server) localOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isLocal(r) {
			writeErr(w, http.StatusForbidden, "the password can only be changed on the computer running KarotX")
			return
		}
		h(w, r)
	}
}

func isLocal(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func setSession(w http.ResponseWriter, t string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: t, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 30 * 24 * 3600,
	})
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"version":       s.opt.Version,
		"addr":          s.opt.Addr,
		"statePath":     s.opt.Store.Path(),
		"authRequired":  s.opt.Auth.Enabled(),
		"authenticated": s.opt.Auth.Valid(token(r)),
		"local":         isLocal(r),
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct{ Password string }
	if !readJSON(w, r, &body) {
		return
	}
	t, err := s.opt.Auth.Login(body.Password)
	if err != nil {
		time.Sleep(500 * time.Millisecond) // slow down guessing
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	setSession(w, t)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.opt.Auth.Logout(token(r))
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) {
	var body struct{ Current, Password string }
	if !readJSON(w, r, &body) {
		return
	}
	t, err := s.opt.Auth.Set(body.Current, body.Password)
	if err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, auth.ErrWrongPassword) {
			code = http.StatusUnauthorized
		}
		writeErr(w, code, err.Error())
		return
	}
	setSession(w, t)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removePassword(w http.ResponseWriter, r *http.Request) {
	var body struct{ Current string }
	if !readJSON(w, r, &body) {
		return
	}
	if err := s.opt.Auth.Remove(body.Current); err != nil {
		code := http.StatusInternalServerError
		if errors.Is(err, auth.ErrWrongPassword) {
			code = http.StatusUnauthorized
		}
		writeErr(w, code, err.Error())
		return
	}
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
