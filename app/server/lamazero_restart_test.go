package server

import "testing"

func TestLamazeroRestartPending(t *testing.T) {
	s := &Server{}
	if s.LamazeroRestartPending("turbo", "turbo3") {
		t.Fatal("aucun redémarrage requis avant le premier lancement")
	}
	s.setAppliedLamazero("", "")
	if s.LamazeroRestartPending("auto", "f16") {
		t.Fatal("valeurs vides = valeurs par défaut : pas de redémarrage")
	}
	if !s.LamazeroRestartPending("turbo", "f16") {
		t.Fatal("changer le moteur doit demander un redémarrage")
	}
	if !s.LamazeroRestartPending("auto", "turbo3") {
		t.Fatal("changer le cache KV doit demander un redémarrage")
	}
	s.setAppliedLamazero("turbo", "turbo3")
	if s.LamazeroRestartPending("turbo", "turbo3") {
		t.Fatal("après redémarrage avec ces valeurs : plus de redémarrage requis")
	}
}
