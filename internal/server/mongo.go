package server

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/lamprabit/karotx/internal/driver"
	"github.com/lamprabit/karotx/internal/driver/mongodrv"
)

func (s *Server) routeMongo(api *http.ServeMux) {
	a := s.authed
	p := "/api/connections/{id}/mongo/"
	api.HandleFunc("POST "+p+"find", a(s.mongoFind))
	api.HandleFunc("GET "+p+"fields", a(s.mongoFields))
	api.HandleFunc("POST "+p+"insert", a(s.mongoInsert))
	api.HandleFunc("POST "+p+"replace", a(s.mongoReplace))
	api.HandleFunc("POST "+p+"delete", a(s.mongoDelete))
	api.HandleFunc("POST "+p+"aggregate", a(s.mongoAggregate))
	api.HandleFunc("POST "+p+"command", a(s.mongoCommand))
	api.HandleFunc("POST "+p+"collection", a(s.mongoCreateCollection))
	api.HandleFunc("POST "+p+"drop", a(s.mongoDrop))
}

func (s *Server) doc(w http.ResponseWriter, r *http.Request) (driver.Document, bool) {
	c, err := s.opt.Conns.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		connErr(w, err)
		return nil, false
	}
	d, ok := c.(driver.Document)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this action is only available for document databases")
	}
	return d, ok
}

// writeGuard applies read-only and production rules to a change. what is
// shown in the confirmation; destructive changes need confirmation on
// production connections.
func (s *Server) writeGuard(w http.ResponseWriter, r *http.Request, confirmed, destructive bool, what string) bool {
	cfg := s.connConfig(r.PathValue("id"))
	if cfg.ReadOnly {
		writeErr(w, http.StatusForbidden, "this connection is read-only")
		return false
	}
	if destructive && cfg.Production && !confirmed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]any{
			"error":             "This is a production connection. Confirm before changing or deleting data.",
			"needsConfirmation": true,
			"statements":        []string{what},
		})
		return false
	}
	return true
}

type collReq struct {
	DB         string `json:"db"`
	Collection string `json:"collection"`
	Confirmed  bool   `json:"confirmed"`
}

func (s *Server) mongoFind(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		driver.FindRequest
		QueryID string `json:"queryId"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok {
		return
	}
	var res *driver.FindResult
	var err error
	err = s.opt.Conns.Run(r.Context(), b.QueryID, func(ctx context.Context) error {
		res, err = d.Find(ctx, b.DB, b.Collection, b.FindRequest)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, res)
}

func (s *Server) mongoFields(w http.ResponseWriter, r *http.Request) {
	d, ok := s.doc(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	f, err := d.Fields(r.Context(), q.Get("db"), q.Get("collection"))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, f)
}

func (s *Server) mongoInsert(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		Docs  []json.RawMessage `json:"docs"`
		Clear bool              `json:"clear"` // delete every document first (import)
	}
	if !readBig(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok || !s.writeGuard(w, r, b.Confirmed, b.Clear, "Delete every document in "+b.Collection+" before importing") {
		return
	}
	if b.Clear {
		if _, err := d.DeleteAll(r.Context(), b.DB, b.Collection); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	n, err := d.Insert(r.Context(), b.DB, b.Collection, b.Docs)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]int{"inserted": n})
}

func (s *Server) mongoReplace(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		ID  json.RawMessage `json:"id"`
		Doc json.RawMessage `json:"doc"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok || !s.writeGuard(w, r, b.Confirmed, true, "replace document _id "+string(b.ID)+" in "+b.Collection) {
		return
	}
	if err := d.Replace(r.Context(), b.DB, b.Collection, b.ID, b.Doc); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) mongoDelete(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		IDs []json.RawMessage `json:"ids"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok || !s.writeGuard(w, r, b.Confirmed, true, "delete "+itoa(len(b.IDs))+" document(s) from "+b.Collection) {
		return
	}
	n, err := d.Delete(r.Context(), b.DB, b.Collection, b.IDs)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]int64{"deleted": n})
}

func (s *Server) mongoAggregate(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		Pipeline json.RawMessage `json:"pipeline"`
		QueryID  string          `json:"queryId"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok {
		return
	}
	if mongodrv.PipelineWrites(b.Pipeline) && !s.writeGuard(w, r, b.Confirmed, true, "aggregation with $out/$merge on "+b.Collection) {
		return
	}
	var docs []json.RawMessage
	var err error
	err = s.opt.Conns.Run(r.Context(), b.QueryID, func(ctx context.Context) error {
		docs, err = d.Aggregate(ctx, b.DB, b.Collection, b.Pipeline, 1000)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]any{"docs": docs})
}

func (s *Server) mongoCommand(w http.ResponseWriter, r *http.Request) {
	var b struct {
		collReq
		Command json.RawMessage `json:"command"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok {
		return
	}
	if !mongodrv.IsReadCommand(b.Command) && !s.writeGuard(w, r, b.Confirmed, true, "command "+mongodrv.CommandName(b.Command)) {
		return
	}
	res, err := d.RunCommand(r.Context(), b.DB, b.Command)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, map[string]json.RawMessage{"result": res})
}

func (s *Server) mongoCreateCollection(w http.ResponseWriter, r *http.Request) {
	var b collReq
	if !readJSON(w, r, &b) {
		return
	}
	d, ok := s.doc(w, r)
	if !ok || !s.writeGuard(w, r, b.Confirmed, false, "") {
		return
	}
	if err := d.CreateCollection(r.Context(), b.DB, b.Collection); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// mongoDrop drops a collection, or the whole database when collection is empty.
func (s *Server) mongoDrop(w http.ResponseWriter, r *http.Request) {
	var b collReq
	if !readJSON(w, r, &b) {
		return
	}
	what := "drop database " + b.DB
	if b.Collection != "" {
		what = "drop collection " + b.DB + "." + b.Collection
	}
	d, ok := s.doc(w, r)
	if !ok || !s.writeGuard(w, r, b.Confirmed, true, what) {
		return
	}
	var err error
	if b.Collection != "" {
		err = d.DropCollection(r.Context(), b.DB, b.Collection)
	} else {
		err = d.DropDatabase(r.Context(), b.DB)
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
