package sqldb

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"errors"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/lamprabit/karotx/internal/driver"
)

func init() { driver.Register("mysql", Driver{mysqlDialect{}}) }

type mysqlDialect struct{}

func (mysqlDialect) name() string           { return "mysql" }
func (mysqlDialect) hashComments() bool     { return true }
func (mysqlDialect) placeholder(int) string { return "?" }
func (mysqlDialect) quote(id string) string { return "`" + strings.ReplaceAll(id, "`", "``") + "`" }

func (mysqlDialect) open(ctx context.Context, p driver.OpenParams) (*sql.DB, error) {
	c := p.Conn
	port := c.Port
	if port == 0 {
		port = 3306
	}
	cfg := mysql.NewConfig()
	cfg.User, cfg.Passwd, cfg.DBName = c.User, p.Password, c.Database
	cfg.Net, cfg.Addr = "tcp", net.JoinHostPort(c.Host, strconv.Itoa(port))
	cfg.Timeout = 15 * time.Second
	cfg.AllowNativePasswords = true
	cfg.Collation = "utf8mb4_general_ci"
	cfg.Params = map[string]string{}

	if p.Dial != nil {
		cfg.Net = "karotx-" + c.ID // custom network routed through the SSH tunnel
		mysql.RegisterDialContext(cfg.Net, func(ctx context.Context, addr string) (net.Conn, error) {
			return p.Dial(ctx, "tcp", addr)
		})
	}

	switch c.TLS.Mode {
	case "off":
		cfg.TLSConfig = "false"
	case "", "prefer":
		cfg.TLSConfig = "preferred"
	default:
		t, err := tlsConfig(c.Host, c.TLS.Mode == "verify", c.TLS.CAFile, c.TLS.CertFile, c.TLS.KeyFile)
		if err != nil {
			return nil, err
		}
		cfg.TLS = t
	}

	if c.ReadOnly {
		// MySQL 8 / MariaDB 11 name; older MariaDB uses tx_read_only.
		cfg.Params["transaction_read_only"] = "1"
		if db, err := openMySQL(ctx, cfg); err == nil {
			return db, nil
		}
		delete(cfg.Params, "transaction_read_only")
		cfg.Params["tx_read_only"] = "1"
	}
	return openMySQL(ctx, cfg)
}

func openMySQL(ctx context.Context, cfg *mysql.Config) (*sql.DB, error) {
	connector, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	if len(cfg.Params) > 0 { // verify session variables are accepted
		if err := db.PingContext(ctx); err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}

func tlsConfig(host string, verify bool, caFile, certFile, keyFile string) (*tls.Config, error) {
	t := &tls.Config{ServerName: host, InsecureSkipVerify: !verify, MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, err
		}
		t.RootCAs = x509.NewCertPool()
		if !t.RootCAs.AppendCertsFromPEM(pem) {
			return nil, errors.New("the CA file contains no certificates")
		}
	}
	if certFile != "" {
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, err
		}
		t.Certificates = []tls.Certificate{cert}
	}
	return t, nil
}

func (mysqlDialect) version(ctx context.Context, db *sql.DB) string {
	var v string
	db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&v)
	if strings.Contains(strings.ToLower(v), "mariadb") {
		return "MariaDB " + strings.SplitN(v, "-", 2)[0]
	}
	return "MySQL " + v
}

func (mysqlDialect) tree(ctx context.Context, db *sql.DB, path []string) ([]driver.Node, error) {
	switch len(path) {
	case 0:
		return queryNodes(ctx, db, path, false, `
			SELECT schema_name, 'database' FROM information_schema.schemata
			WHERE schema_name NOT IN ('information_schema','performance_schema','sys')
			ORDER BY schema_name`)
	case 1:
		return queryNodes(ctx, db, path, false, `
			SELECT table_name, IF(table_type = 'VIEW', 'view', 'table')
			FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`, path[0])
	case 2:
		return queryNodes(ctx, db, path, true, `
			SELECT column_name, 'column', column_type, column_key = 'PRI'
			FROM information_schema.columns WHERE table_schema = ? AND table_name = ?
			ORDER BY ordinal_position`, path[0], path[1])
	}
	return []driver.Node{}, nil
}

func (m mysqlDialect) useSchema(schema string) string { return "USE " + m.quote(schema) }

func (mysqlDialect) tables(ctx context.Context, db *sql.DB, schema string) ([]driver.TableInfo, error) {
	return queryTables(ctx, db, `
		SELECT table_name, IF(table_type = 'VIEW', 'view', 'table'), table_rows, data_length + index_length
		FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name`, schema)
}

func (mysqlDialect) columns(ctx context.Context, db *sql.DB, t driver.TableRef) ([]driver.ColumnInfo, error) {
	return queryColumns(ctx, db, `
		SELECT column_name, column_type, is_nullable = 'YES', column_default, column_key = 'PRI', extra LIKE '%auto_increment%'
		FROM information_schema.columns WHERE table_schema = ? AND table_name = ?
		ORDER BY ordinal_position`, t.Schema, t.Table)
}
