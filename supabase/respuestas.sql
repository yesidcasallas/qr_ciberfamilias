-- Proyecto CiberFamilias: respuestas del sitio (formulario sencillo y simulador).
-- Se corre una vez: Supabase → SQL Editor → pega este archivo → Run. Volver a correrlo no rompe nada.
--
-- El sitio usa la clave publicable (rol anon), que queda a la vista en el código de la página. Por eso
-- con esa clave solo se pueden AGREGAR filas: nadie puede leer, cambiar ni borrar respuestas. Las
-- respuestas se ven en Table Editor → respuestas, con la sesión del equipo en Supabase.

create table if not exists public.respuestas (
  id bigint generated always as identity primary key,
  creada timestamptz not null default now(),
  origen text not null check (origen in ('formulario', 'simulador')),
  correo text not null check (char_length(correo) <= 120 and correo ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  universidad text not null check (char_length(universidad) between 2 and 120),
  senuelos integer check (senuelos between 0 and 999), -- simulador: en cuántos señuelos cayó
  resistio boolean, -- simulador: si resistió al estafador
  check (origen = 'simulador' or (senuelos is null and resistio is null))
);

alter table public.respuestas enable row level security;

-- La clave publicable solo agrega filas y solo con estas columnas (el id y la fecha los pone la base).
-- Los grants son explícitos: en Supabase las tablas nuevas ya no quedan expuestas solas a la Data API.
grant usage on schema public to anon;
revoke all on table public.respuestas from anon, authenticated;
grant insert (origen, correo, universidad, senuelos, resistio) on table public.respuestas to anon;

-- La validación la hacen las restricciones de la tabla; la política solo abre el INSERT al sitio.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'respuestas' and policyname = 'el sitio solo agrega respuestas'
  ) then
    create policy "el sitio solo agrega respuestas" on public.respuestas for insert to anon with check (true);
  end if;
end
$$;
