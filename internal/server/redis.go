package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
)

func (s *Server) routeRedis(api *http.ServeMux) {
	a := s.authed
	api.HandleFunc("GET /api/connections/{id}/redis/keys", a(s.redisKeys))
	api.HandleFunc("GET /api/connections/{id}/redis/key", a(s.redisKey))
	api.HandleFunc("GET /api/connections/{id}/redis/dbsize", a(s.redisDBSize))
	api.HandleFunc("POST /api/connections/{id}/redis/command", a(s.redisCommand))
}

// connConfig returns the saved settings (read-only, production) of a connection.
func (s *Server) connConfig(id string) model.Connection {
	for _, c := range s.opt.Conns.List() {
		if c.ID == id {
			return c.Connection
		}
	}
	return model.Connection{}
}

func (s *Server) kv(w http.ResponseWriter, r *http.Request) (driver.KeyValue, int, bool) {
	c, err := s.opt.Conns.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		connErr(w, err)
		return nil, 0, false
	}
	kv, ok := c.(driver.KeyValue)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this action is only available for key-value databases")
		return nil, 0, false
	}
	db, _ := strconv.Atoi(r.URL.Query().Get("db"))
	return kv, db, true
}

func (s *Server) redisKeys(w http.ResponseWriter, r *http.Request) {
	kv, db, ok := s.kv(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	count, _ := strconv.Atoi(q.Get("count"))
	page, err := kv.Scan(r.Context(), db, q.Get("pattern"), q.Get("cursor"), count, q.Get("type"))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, page)
}

func (s *Server) redisKey(w http.ResponseWriter, r *http.Request) {
	kv, db, ok := s.kv(w, r)
	if !ok {
		return
	}
	d, err := kv.GetKey(r.Context(), db, r.URL.Query().Get("key"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, d)
}

func (s *Server) redisDBSize(w http.ResponseWriter, r *http.Request) {
	kv, db, ok := s.kv(w, r)
	if !ok {
		return
	}
	n, err := kv.DBSize(r.Context(), db)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, map[string]int64{"keys": n})
}

// redisCommand runs one command: from the console (line) or a UI edit (args).
// Read-only connections refuse writes; production ones ask first.
func (s *Server) redisCommand(w http.ResponseWriter, r *http.Request) {
	var b struct {
		DB        int      `json:"db"`
		Args      []string `json:"args"`
		Line      string   `json:"line"`
		Confirmed bool     `json:"confirmed"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	c, err := s.opt.Conns.Session(r.Context(), id)
	if err != nil {
		connErr(w, err)
		return
	}
	kv, ok := c.(driver.KeyValue)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this action is only available for key-value databases")
		return
	}
	args := b.Args
	if b.Line != "" {
		if args, err = driver.SplitCommand(b.Line); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if len(args) == 0 {
		writeErr(w, http.StatusBadRequest, "type a command")
		return
	}
	cfg := s.connConfig(id)
	if kv.IsWrite(args) {
		if cfg.ReadOnly {
			writeErr(w, http.StatusForbidden, "this connection is read-only, so "+strings.ToUpper(args[0])+" isn't allowed")
			return
		}
		if cfg.Production && !b.Confirmed {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":             "This is a production connection. Confirm before changing data.",
				"needsConfirmation": true,
				"statements":        []string{quoteArgs(args)},
			})
			return
		}
	}
	var res any
	err = s.opt.Conns.Run(r.Context(), "", func(ctx context.Context) error {
		res, err = kv.Do(ctx, b.DB, args)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]any{"result": res})
}

// quoteArgs renders a command for display, quoting arguments with spaces.
func quoteArgs(args []string) string {
	out := make([]string, len(args))
	for i, a := range args {
		if a == "" || strings.ContainsAny(a, " \t\n\"'") {
			out[i] = strconv.Quote(a)
		} else {
			out[i] = a
		}
	}
	return strings.Join(out, " ")
}
