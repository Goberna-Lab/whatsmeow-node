package main

import (
	"errors"
	"testing"

	"go.mau.fi/whatsmeow/store"
)

var compiladaDePrueba = store.WAVersionContainer{2, 3000, 1040847988}

func consultaQueDevuelve(v store.WAVersionContainer) func() (*store.WAVersionContainer, error) {
	return func() (*store.WAVersionContainer, error) { return &v, nil }
}

func consultaQueFalla() (*store.WAVersionContainer, error) {
	return nil, errors.New("sin red")
}

func consultaProhibida(t *testing.T) func() (*store.WAVersionContainer, error) {
	return func() (*store.WAVersionContainer, error) {
		t.Fatal("no debía consultar la web")
		return nil, nil
	}
}

func TestLaVariableGanaSinConsultar(t *testing.T) {
	e := elegirVersion(compiladaDePrueba, "2.3000.1049558099", consultaProhibida(t))
	if e.origen != "env" || e.version != (store.WAVersionContainer{2, 3000, 1049558099}) {
		t.Fatalf("esperaba la del env, vino %+v", e)
	}
}

// El operador manda aunque escriba una más vieja: sabe por qué la escribe.
func TestLaVariableGanaAunqueSeaMasVieja(t *testing.T) {
	e := elegirVersion(compiladaDePrueba, "2.3000.1", consultaProhibida(t))
	if e.origen != "env" || e.version.String() != "2.3000.1" {
		t.Fatalf("esperaba 2.3000.1 del env, vino %+v", e)
	}
}

func TestCompiladaApagaLaConsulta(t *testing.T) {
	e := elegirVersion(compiladaDePrueba, "compilada", consultaProhibida(t))
	if e.origen != "compilada" || e.version != compiladaDePrueba {
		t.Fatalf("esperaba la compilada, vino %+v", e)
	}
}

func TestSinVariableUsaLaWebSiEsMasNueva(t *testing.T) {
	web := store.WAVersionContainer{2, 3000, 1049558099}
	e := elegirVersion(compiladaDePrueba, "", consultaQueDevuelve(web))
	if e.origen != "web" || e.version != web {
		t.Fatalf("esperaba la de la web, vino %+v", e)
	}
}

// Una respuesta rara de la web nunca puede BAJAR la versión.
func TestLaWebNoBajaLaVersion(t *testing.T) {
	e := elegirVersion(compiladaDePrueba, "", consultaQueDevuelve(store.WAVersionContainer{2, 3000, 1}))
	if e.origen != "compilada" || e.version != compiladaDePrueba {
		t.Fatalf("esperaba la compilada, vino %+v", e)
	}
}

func TestSiLaConsultaFallaQuedaLaCompilada(t *testing.T) {
	e := elegirVersion(compiladaDePrueba, "", consultaQueFalla)
	if e.origen != "compilada" || e.version != compiladaDePrueba || e.motivo == "" {
		t.Fatalf("esperaba la compilada con motivo, vino %+v", e)
	}
}

// Una variable mal escrita no deja la línea con la vieja: cae a la consulta.
func TestVariableIlegibleCaeALaConsulta(t *testing.T) {
	web := store.WAVersionContainer{2, 3000, 1049558099}
	e := elegirVersion(compiladaDePrueba, "dos punto tres", consultaQueDevuelve(web))
	if e.origen != "web" || e.version != web || e.motivo == "" {
		t.Fatalf("esperaba la de la web con motivo, vino %+v", e)
	}
}
