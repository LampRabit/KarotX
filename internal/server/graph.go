package server

import (
	"context"
	"net/http"

	"github.com/lamprabit/karotx/internal/driver"
)

func (s *Server) routeGraph(api *http.ServeMux) {
	api.HandleFunc("POST /api/connections/{id}/graph/run", s.authed(s.graphRun))
}

// graphRun runs one Cypher query. Writes are refused on read-only
// connections and need confirmation on production ones; reads run in a
// read-only transaction.
func (s *Server) graphRun(w http.ResponseWriter, r *http.Request) {
	var b struct {
		DB        string         `json:"db"`
		Query     string         `json:"query"`
		Params    map[string]any `json:"params"`
		Confirmed bool           `json:"confirmed"`
		QueryID   string         `json:"queryId"`
	}
	if !readJSON(w, r, &b) {
		return
	}
	c, err := s.opt.Conns.Session(r.Context(), r.PathValue("id"))
	if err != nil {
		connErr(w, err)
		return
	}
	g, ok := c.(driver.Graph)
	if !ok {
		writeErr(w, http.StatusBadRequest, "this action is only available for graph databases")
		return
	}
	write := driver.IsCypherWrite(b.Query)
	if write && !s.writeGuard(w, r, b.Confirmed, true, b.Query) {
		return
	}
	var res *driver.GraphResult
	err = s.opt.Conns.Run(r.Context(), b.QueryID, func(ctx context.Context) error {
		res, err = g.Run(ctx, b.DB, b.Query, b.Params, write, 1000)
		return err
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, res)
}
