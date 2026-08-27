--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
-- pg_dump normally emits `SELECT pg_catalog.set_config('search_path', '', false);`
-- here to force every later statement to be fully schema-qualified. That
-- breaks `CREATE EXTENSION` (Postgres refuses it with "no schema has been
-- selected to create in" under an empty search_path), which in turn leaves
-- the postgis-provided `geography` type missing for the `camera` table
-- created further down. Left out deliberately — every statement in this
-- file is already fully schema-qualified (public.*) by pg_dump, so a
-- non-empty search_path here is safe.
SET search_path = public;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

-- Required extensions (not modeled in schema.prisma — Prisma's schema-diff
-- doesn't know about Postgres extensions, so these must be added by hand to
-- every environment that applies this migration, e.g. a fresh shadow
-- database used by `prisma migrate dev`).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;


--
-- Name: app_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    department_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT app_user_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'field_officer'::text, 'dept_viewer'::text, 'auditor'::text])))
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: camera; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camera (
    camera_id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    location_geo public.geography(Point,4326) NOT NULL,
    address_text text,
    camera_type text NOT NULL,
    brand text,
    model text,
    onvif_status text DEFAULT 'unknown'::text NOT NULL,
    onvif_source text,
    integration_score text DEFAULT 'needs_verification'::text NOT NULL,
    data_confidence text DEFAULT 'self_reported'::text NOT NULL,
    photo_url text,
    ip_address inet,
    rtsp_port integer,
    stream_path text,
    current_status text DEFAULT 'unknown'::text NOT NULL,
    installed_at date,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT camera_camera_type_check CHECK ((camera_type = ANY (ARRAY['analog'::text, 'ip'::text]))),
    CONSTRAINT camera_current_status_check CHECK ((current_status = ANY (ARRAY['online'::text, 'offline'::text, 'unknown'::text]))),
    CONSTRAINT camera_data_confidence_check CHECK ((data_confidence = ANY (ARRAY['verified_in_person'::text, 'verified_api'::text, 'self_reported'::text]))),
    CONSTRAINT camera_integration_score_check CHECK ((integration_score = ANY (ARRAY['easy'::text, 'medium'::text, 'hard'::text, 'needs_verification'::text]))),
    CONSTRAINT camera_onvif_source_check CHECK (((onvif_source = ANY (ARRAY['lookup_table'::text, 'ai_guess'::text, 'user_confirmed'::text])) OR (onvif_source IS NULL))),
    CONSTRAINT camera_onvif_status_check CHECK ((onvif_status = ANY (ARRAY['yes'::text, 'no'::text, 'unknown'::text])))
);


--
-- Name: camera_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.camera_status_history (
    id bigint NOT NULL,
    camera_id uuid NOT NULL,
    status text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    response_time_ms integer,
    CONSTRAINT camera_status_history_status_check CHECK ((status = ANY (ARRAY['online'::text, 'offline'::text])))
);


--
-- Name: camera_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.camera_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: camera_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.camera_status_history_id_seq OWNED BY public.camera_status_history.id;


--
-- Name: department; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department (
    department_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: refresh_token; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_token (
    token_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone
);


--
-- Name: scoring_verification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_verification (
    verification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    camera_id uuid NOT NULL,
    ai_suggested_onvif text,
    ai_confidence_note text,
    verified_by uuid,
    verified_at timestamp with time zone,
    final_onvif_status text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT scoring_verification_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'rejected'::text])))
);


--
-- Name: vendor_lookup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_lookup (
    lookup_id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand text NOT NULL,
    model_pattern text NOT NULL,
    onvif_status text NOT NULL,
    sdk_available boolean DEFAULT false,
    source text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_lookup_onvif_status_check CHECK ((onvif_status = ANY (ARRAY['yes'::text, 'no'::text]))),
    CONSTRAINT vendor_lookup_source_check CHECK ((source = ANY (ARRAY['official_datasheet'::text, 'community'::text, 'ai_verified'::text])))
);


--
-- Name: camera_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_status_history ALTER COLUMN id SET DEFAULT nextval('public.camera_status_history_id_seq'::regclass);


--
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (audit_id);


--
-- Name: camera camera_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera
    ADD CONSTRAINT camera_pkey PRIMARY KEY (camera_id);


--
-- Name: camera_status_history camera_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_status_history
    ADD CONSTRAINT camera_status_history_pkey PRIMARY KEY (id);


--
-- Name: department department_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department
    ADD CONSTRAINT department_code_key UNIQUE (code);


--
-- Name: department department_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department
    ADD CONSTRAINT department_pkey PRIMARY KEY (department_id);


--
-- Name: refresh_token refresh_token_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token
    ADD CONSTRAINT refresh_token_pkey PRIMARY KEY (token_id);


--
-- Name: refresh_token refresh_token_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token
    ADD CONSTRAINT refresh_token_token_hash_key UNIQUE (token_hash);


--
-- Name: scoring_verification scoring_verification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_verification
    ADD CONSTRAINT scoring_verification_pkey PRIMARY KEY (verification_id);


--
-- Name: camera uq_camera_department_name; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera
    ADD CONSTRAINT uq_camera_department_name UNIQUE (department_id, name);


--
-- Name: vendor_lookup vendor_lookup_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_lookup
    ADD CONSTRAINT vendor_lookup_pkey PRIMARY KEY (lookup_id);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_id, created_at DESC);


--
-- Name: idx_camera_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camera_department ON public.camera USING btree (department_id);


--
-- Name: idx_camera_integration_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camera_integration_score ON public.camera USING btree (integration_score);


--
-- Name: idx_camera_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camera_is_active ON public.camera USING btree (is_active);


--
-- Name: idx_camera_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_camera_location ON public.camera USING gist (location_geo);


--
-- Name: idx_refresh_token_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_token_user ON public.refresh_token USING btree (user_id);


--
-- Name: idx_scoring_verification_camera; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scoring_verification_camera ON public.scoring_verification USING btree (camera_id);


--
-- Name: idx_scoring_verification_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scoring_verification_status ON public.scoring_verification USING btree (status);


--
-- Name: idx_status_history_camera_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_history_camera_time ON public.camera_status_history USING btree (camera_id, checked_at DESC);


--
-- Name: idx_vendor_lookup_brand_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_lookup_brand_model ON public.vendor_lookup USING btree (brand, model_pattern);


--
-- Name: app_user app_user_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(department_id);


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(user_id);


--
-- Name: camera camera_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera
    ADD CONSTRAINT camera_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.app_user(user_id);


--
-- Name: camera camera_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera
    ADD CONSTRAINT camera_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.department(department_id);


--
-- Name: camera_status_history camera_status_history_camera_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.camera_status_history
    ADD CONSTRAINT camera_status_history_camera_id_fkey FOREIGN KEY (camera_id) REFERENCES public.camera(camera_id);


--
-- Name: refresh_token refresh_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_token
    ADD CONSTRAINT refresh_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(user_id) ON DELETE CASCADE;


--
-- Name: scoring_verification scoring_verification_camera_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_verification
    ADD CONSTRAINT scoring_verification_camera_id_fkey FOREIGN KEY (camera_id) REFERENCES public.camera(camera_id);


--
-- Name: scoring_verification scoring_verification_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_verification
    ADD CONSTRAINT scoring_verification_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.app_user(user_id);


--
-- PostgreSQL database dump complete
--


