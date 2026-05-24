package main

import (
	"flag"
	"log"
	"net/http"
	"time"
)

func main() {
	port := flag.String("port", "5174", "port to listen on")
	flag.Parse()

	log.SetFlags(log.Ltime | log.Lmicroseconds)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/providers", withCORS(handleProviders))
	mux.HandleFunc("/api/canvas", withCORS(handleCanvas))
	mux.HandleFunc("/api/file", withCORS(handleFile))
	mux.HandleFunc("/api/generate", withCORS(handleGenerate))
	mux.HandleFunc("/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))

	addr := ":" + *port
	log.Printf("[server] listening on http://localhost%s", addr)
	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}
