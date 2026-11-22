// Command karotx starts the KarotX database client.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/lamprabit/karotx/internal/auth"
	"github.com/lamprabit/karotx/internal/conn"
	"github.com/lamprabit/karotx/internal/server"
	"github.com/lamprabit/karotx/internal/state"
	"github.com/lamprabit/karotx/web"
)

var version = "dev" // set by -ldflags "-X main.version=..."

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "karotx:", err)
		os.Exit(1)
	}
}

func run() error {
	host := flag.String("host", "0.0.0.0", "address to listen on")
	port := flag.Int("port", 8732, "port to listen on")
	statePath := flag.String("state", "karotx.kxs", "path to the encrypted workspace file (.kxs)")
	theme := flag.String("theme", "", "UI theme id (overrides the state file)")
	services := flag.String("services", "", "services file to watch (JSON list of databases, e.g. from LampRabit); they appear automatically")
	flag.StringVar(services, "lamprabit", "", "alias for --services")
	noOpen := flag.Bool("no-open", false, "don't open the browser on start")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("karotx", version)
		return nil
	}

	if filepath.Ext(*statePath) == "" {
		*statePath += ".kxs"
	}
	store, err := state.Open(*statePath)
	if err != nil {
		return err
	}
	authn, err := auth.Load()
	if err != nil {
		return err
	}
	conns := conn.NewManager(store)
	defer conns.Close()

	addr := net.JoinHostPort(*host, strconv.Itoa(*port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen on %s: %w (use --port to pick another)", addr, err)
	}

	srv := &http.Server{
		Handler: server.New(server.Options{
			Version: version, Addr: addr, Theme: *theme,
			Store: store, Auth: authn, Conns: conns, UI: web.Dist(),
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}

	url := fmt.Sprintf("http://localhost:%d", *port)
	fmt.Printf("\n  KarotX %s\n\n  UI:        %s\n  Workspace: %s\n\n", version, url, store.Path())
	if !authn.Enabled() && !isLoopback(*host) {
		fmt.Printf("  ⚠ Listening on %s without a password. Anyone on your network\n    can reach your databases. Set one in Settings → Security.\n\n", *host)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if *services != "" {
		go conns.WatchServices(ctx, *services)
		fmt.Printf("  Services:  watching %s\n\n", *services)
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	if !*noOpen {
		openBrowser(url)
	}
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}
