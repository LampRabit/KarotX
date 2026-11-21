package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/lamprabit/karotx/internal/conn"
	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/model"
	"github.com/lamprabit/karotx/internal/state"
	"github.com/lamprabit/karotx/internal/tunnel"
)

func (s *Server) routeConnections(api *http.ServeMux) {
	a := s.authed
	api.HandleFunc("GET /api/connections", a(s.listConnections))
	api.HandleFunc("POST /api/connections", a(s.saveConnection))
	api.HandleFunc("PUT /api/connections/{id}", a(s.saveConnection))
	api.HandleFunc("DELETE /api/connections/{id}", a(s.deleteConnection))
	api.HandleFunc("PUT /api/connections/order", a(s.reorderConnections))
	api.HandleFunc("POST /api/connections/test", a(s.testConnection))
	api.HandleFunc("POST /api/connections/{id}/connect", a(s.connect))
	api.HandleFunc("POST /api/connections/{id}/disconnect", a(s.disconnect))
	api.HandleFunc("GET /api/connections/{id}/tree", a(s.tree))
	api.HandleFunc("GET /api/connections/{id}/tables", a(s.tables))
	api.HandleFunc("GET /api/connections/{id}/columns", a(s.columns))
	api.HandleFunc("GET /api/connections/{id}/foreignkeys", a(s.foreignKeys))
	api.HandleFunc("GET /api/fs", a(s.browseFS))
	api.HandleFunc("POST /api/fs/sqlite", a(s.createSQLite))
	api.HandleFunc("POST /api/connections/{id}/query", a(s.query))
	api.HandleFunc("POST /api/connections/{id}/browse", a(s.browse))
	api.HandleFunc("POST /api/connections/{id}/apply", a(s.apply))
	api.HandleFunc("POST /api/queries/{qid}/cancel", a(s.cancelQuery))
	api.HandleFunc("PUT /api/workspace", a(s.saveWorkspace))
}

type saveBody struct {
	Connection model.Connection   `json:"connection"`
	Secrets    *conn.SecretsInput `json:"secrets"`
}

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.opt.Conns.List())
}

func (s *Server) saveConnection(w http.ResponseWriter, r *http.Request) {
	var b saveBody
	if !readJSON(w, r, &b) {
		return
	}
	b.Connection.ID = r.PathValue("id")
	c, err := s.opt.Conns.Save(b.Connection, b.Secrets)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, conn.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeErr(w, status, err.Error())
		return
	}
	writeJSON(w, c)
}

func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	if err := s.opt.Conns.Delete(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reorderConnections(w http.ResponseWriter, r *http.Request) {
	var ids []string
	if !readJSON(w, r, &ids) {
		return
	}
	if err := s.opt.Conns.Reorder(ids); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// connErr reports a database/SSH failure. Unknown SSH host keys get a 409
// with the fingerprint so the UI can ask the user to trust it.
func connErr(w http.ResponseWriter, err error) {
	var uh *tunnel.UnknownHostError
	if errors.As(err, &uh) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "hostKey": uh})
		return
	}
	if errors.Is(err, conn.ErrNotFound) {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeErr(w, http.StatusBadGateway, err.Error())
}

func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	var b saveBody
	if !readJSON(w, r, &b) {
		return
	}
	info, err := s.opt.Conns.Test(r.Context(), b.Connection, b.Secrets)
	if err != nil {
		connErr(w, err)
		return
	}
	writeJSON(w, info)
}

func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	c, err := s.opt.Conns.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		connErr(w, err)
		return
	}
	writeJSON(w, c.Info())
}

func (s *Server) disconnect(w http.ResponseWriter, r *http.Request) {
	if db := r.URL.Query().Get("db"); db != "" {
		s.opt.Conns.DisconnectDB(r.PathValue("id"), db) // e.g. before dropping that database
	} else {
		s.opt.Conns.Disconnect(r.PathValue("id"))
	}
	w.WriteHeader(http.StatusNoContent)
}

// tree lists children of a node. For Postgres the root lists the server's
// databases; children of a database are requested with ?db=<name> and their
// paths are prefixed with it, so node paths stay unique across databases.
func (s *Server) tree(w http.ResponseWriter, r *http.Request) {
	id, q := r.PathValue("id"), r.URL.Query()
	db, path := q.Get("db"), q["path"]
	c, err := s.opt.Conns.SessionDB(r.Context(), id, db)
	if err != nil {
		connErr(w, err)
		return
	}
	if db == "" && len(path) == 0 {
		if dbs, err := c.Databases(r.Context()); err == nil && dbs != nil {
			nodes := make([]driver.Node, len(dbs))
			for i, name := range dbs {
				nodes[i] = driver.Node{Name: name, Kind: "database", Path: []string{name}, HasChildren: true}
				if name == c.Info().Database {
					nodes[i].Detail = "default"
				}
			}
			writeJSON(w, nodes)
			return
		}
	}
	nodes, err := c.Tree(r.Context(), path)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if db != "" {
		for i := range nodes {
			nodes[i].Path = append([]string{db}, nodes[i].Path...)
		}
	}
	writeJSON(w, nodes)
}

func (s *Server) tables(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := s.opt.Conns.SessionDB(r.Context(), r.PathValue("id"), q.Get("db"))
	if err != nil {
		connErr(w, err)
		return
	}
	t, err := c.Tables(r.Context(), q.Get("schema"))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, t)
}

func (s *Server) columns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := s.opt.Conns.SessionDB(r.Context(), r.PathValue("id"), q.Get("db"))
	if err != nil {
		connErr(w, err)
		return
	}
	cols, err := c.Columns(r.Context(), driver.TableRef{Schema: q.Get("schema"), Table: q.Get("table")})
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, cols)
}

func (s *Server) foreignKeys(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c, err := s.opt.Conns.SessionDB(r.Context(), r.PathValue("id"), q.Get("db"))
	if err != nil {
		connErr(w, err)
		return
	}
	fks, err := c.ForeignKeys(r.Context(), q.Get("schema"))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, fks)
}

// guard enforces the production safety rule: destructive work on a
// production connection needs explicit confirmation from the user.
func (s *Server) guard(w http.ResponseWriter, id string, confirmed bool, risky []string) bool {
	if confirmed || len(risky) == 0 {
		return true
	}
	for _, c := range s.opt.Conns.List() {
		if c.ID == id && c.Production {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":             "This is a production connection. Confirm before running statements that change or remove data.",
				"needsConfirmation": true,
				"statements":        risky,
			})
			return false
		}
	}
	return true
}

func (s *Server) query(w http.ResponseWriter, r *http.Request) {
	var b struct {
		SQL       string `json:"sql"`
		Database  string `json:"database"`
		Schema    string `json:"schema"`
		QueryID   string `json:"queryId"`
		MaxRows   int    `json:"maxRows"`
		Confirmed bool   `json:"confirmed"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	var risky []string
	for _, st := range driver.SplitSQL(b.SQL, true) {
		if driver.IsDestructive(st) {
			risky = append(risky, st)
		}
	}
	if !s.guard(w, id, b.Confirmed, risky) {
		return
	}
	c, err := s.opt.Conns.SessionDB(r.Context(), id, b.Database)
	if err != nil {
		connErr(w, err)
		return
	}
	var results []*driver.Result
	err = s.opt.Conns.Run(r.Context(), b.QueryID, func(ctx context.Context) error {
		results, err = c.Query(ctx, b.SQL, driver.QueryOptions{MaxRows: b.MaxRows, Schema: b.Schema})
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, results)
}

func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	var b struct {
		driver.BrowseRequest
		QueryID string `json:"queryId"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	c, err := s.opt.Conns.SessionDB(r.Context(), r.PathValue("id"), b.Database)
	if err != nil {
		connErr(w, err)
		return
	}
	var res *driver.Result
	err = s.opt.Conns.Run(r.Context(), b.QueryID, func(ctx context.Context) error {
		res, err = c.Browse(ctx, b.BrowseRequest)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, res)
}

func (s *Server) apply(w http.ResponseWriter, r *http.Request) {
	var b struct {
		driver.ApplyRequest
		DryRun    bool `json:"dryRun"`
		Confirmed bool `json:"confirmed"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	id := r.PathValue("id")
	c, err := s.opt.Conns.SessionDB(r.Context(), id, b.Database)
	if err != nil {
		connErr(w, err)
		return
	}
	stmts, err := c.Apply(r.Context(), b.ApplyRequest, true)
	if err != nil || b.DryRun {
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
		} else {
			writeJSON(w, stmts)
		}
		return
	}
	if !s.guard(w, id, b.Confirmed, stmts) {
		return
	}
	if stmts, err = c.Apply(r.Context(), b.ApplyRequest, false); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, stmts)
}

func (s *Server) cancelQuery(w http.ResponseWriter, r *http.Request) {
	s.opt.Conns.Cancel(r.PathValue("qid"))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) saveWorkspace(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Tabs      []json.RawMessage `json:"tabs"`
		ActiveTab string            `json:"activeTab"`
		Expanded  []string          `json:"expanded"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	if err := s.opt.Store.Update(func(st *state.State) {
		st.Tabs, st.ActiveTab, st.Expanded = b.Tabs, b.ActiveTab, b.Expanded
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
