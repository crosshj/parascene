-- Desktop Library folders: owner-scoped folder metadata + creation memberships.
-- Sync uses a per-user revision for compare-and-swap mutations.
-- Run after supabase_01.sql (requires prsn_users, prsn_created_images).

CREATE TABLE IF NOT EXISTS prsn_library_folder_sync (
	user_id bigint PRIMARY KEY REFERENCES prsn_users(id) ON DELETE CASCADE,
	revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
	updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prsn_library_folder_sync ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE prsn_library_folder_sync IS 'Parascene: per-user Library folder sync revision (CAS). RLS enabled without policies - only service role can access. All access controlled via API layer.';

CREATE TABLE IF NOT EXISTS prsn_library_folders (
	id uuid PRIMARY KEY,
	user_id bigint NOT NULL REFERENCES prsn_users(id) ON DELETE CASCADE,
	title text NOT NULL,
	description text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prsn_library_folders_user_updated
	ON prsn_library_folders (user_id, updated_at DESC, title ASC);

ALTER TABLE prsn_library_folders ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE prsn_library_folders IS 'Parascene: desktop Library folders (metadata only). RLS enabled without policies - only service role can access. All access controlled via API layer.';

CREATE TABLE IF NOT EXISTS prsn_library_folder_items (
	user_id bigint NOT NULL REFERENCES prsn_users(id) ON DELETE CASCADE,
	folder_id uuid NOT NULL REFERENCES prsn_library_folders(id) ON DELETE CASCADE,
	creation_id bigint NOT NULL REFERENCES prsn_created_images(id) ON DELETE CASCADE,
	added_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (folder_id, creation_id),
	CONSTRAINT prsn_library_folder_items_user_creation_unique UNIQUE (user_id, creation_id)
);

CREATE INDEX IF NOT EXISTS idx_prsn_library_folder_items_user_folder_added
	ON prsn_library_folder_items (user_id, folder_id, added_at ASC, creation_id ASC);

CREATE INDEX IF NOT EXISTS idx_prsn_library_folder_items_creation
	ON prsn_library_folder_items (creation_id);

ALTER TABLE prsn_library_folder_items ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE prsn_library_folder_items IS 'Parascene: Library folder membership (one folder per creation per user). RLS enabled without policies - only service role can access. All access controlled via API layer.';

-- Snapshot folder array for one user (ordered).
CREATE OR REPLACE FUNCTION prsn_library_folders_snapshot_folders(p_user_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
	SELECT COALESCE(
		jsonb_agg(folder_row ORDER BY folder_row->>'updated_at' DESC, folder_row->>'title' ASC),
		'[]'::jsonb
	)
	FROM (
		SELECT jsonb_build_object(
			'id', f.id,
			'title', f.title,
			'description', f.description,
			'created_at', f.created_at,
			'updated_at', f.updated_at,
			'creation_ids', COALESCE((
				SELECT jsonb_agg(i.creation_id ORDER BY i.added_at ASC, i.creation_id ASC)
				FROM prsn_library_folder_items i
				WHERE i.user_id = f.user_id AND i.folder_id = f.id
			), '[]'::jsonb)
		) AS folder_row
		FROM prsn_library_folders f
		WHERE f.user_id = p_user_id
	) sub;
$$;

COMMENT ON FUNCTION prsn_library_folders_snapshot_folders(bigint) IS 'Parascene: build Library folders JSON array for one user.';

CREATE OR REPLACE FUNCTION prsn_library_folders_get_snapshot(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	v_revision bigint;
BEGIN
	IF p_user_id IS NULL OR p_user_id <= 0 THEN
		RAISE EXCEPTION 'invalid user_id';
	END IF;

	INSERT INTO prsn_library_folder_sync (user_id, revision)
	VALUES (p_user_id, 0)
	ON CONFLICT (user_id) DO NOTHING;

	SELECT revision INTO v_revision
	FROM prsn_library_folder_sync
	WHERE user_id = p_user_id;

	RETURN jsonb_build_object(
		'ok', true,
		'revision', v_revision,
		'folders', prsn_library_folders_snapshot_folders(p_user_id)
	);
END;
$$;

COMMENT ON FUNCTION prsn_library_folders_get_snapshot(bigint) IS 'Parascene: ensure sync row and return Library folders snapshot.';

-- Atomic mutate: CAS on revision, apply ops, bump revision, return snapshot.
CREATE OR REPLACE FUNCTION prsn_library_folders_mutate(
	p_user_id bigint,
	p_base_revision bigint,
	p_operations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	v_revision bigint;
	v_op jsonb;
	v_op_type text;
	v_folder_id uuid;
	v_title text;
	v_description text;
	v_creation_ids bigint[];
	v_creation_id bigint;
	v_idx int;
	v_exists boolean;
	v_owned_count int;
	v_folder_count int;
	v_now timestamptz := now();
	v_touched uuid[] := ARRAY[]::uuid[];
BEGIN
	IF p_user_id IS NULL OR p_user_id <= 0 THEN
		RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'invalid user_id');
	END IF;
	IF p_base_revision IS NULL OR p_base_revision < 0 THEN
		RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'invalid base_revision');
	END IF;
	IF p_operations IS NULL OR jsonb_typeof(p_operations) <> 'array' THEN
		RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'operations must be an array');
	END IF;
	IF jsonb_array_length(p_operations) < 1 THEN
		RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'operations must not be empty');
	END IF;
	IF jsonb_array_length(p_operations) > 100 THEN
		RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'too many operations');
	END IF;

	INSERT INTO prsn_library_folder_sync (user_id, revision)
	VALUES (p_user_id, 0)
	ON CONFLICT (user_id) DO NOTHING;

	SELECT revision INTO v_revision
	FROM prsn_library_folder_sync
	WHERE user_id = p_user_id
	FOR UPDATE;

	IF v_revision IS DISTINCT FROM p_base_revision THEN
		RETURN jsonb_build_object(
			'ok', false,
			'error', 'conflict',
			'revision', v_revision,
			'folders', prsn_library_folders_snapshot_folders(p_user_id)
		);
	END IF;

	FOR v_idx IN 0 .. jsonb_array_length(p_operations) - 1 LOOP
		v_op := p_operations -> v_idx;
		IF jsonb_typeof(v_op) <> 'object' THEN
			RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'operation must be an object');
		END IF;

		v_op_type := lower(trim(COALESCE(v_op->>'op', v_op->>'type', '')));
		IF v_op_type = '' THEN
			RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'operation.op is required');
		END IF;

		IF v_op_type = 'create' THEN
			BEGIN
				v_folder_id := (v_op->>'id')::uuid;
			EXCEPTION WHEN others THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'create.id must be a uuid');
			END;
			IF v_folder_id IS NULL THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'create.id is required');
			END IF;

			v_title := trim(COALESCE(v_op->>'title', ''));
			IF v_title = '' THEN
				v_title := 'Untitled folder';
			END IF;
			IF char_length(v_title) > 200 THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'title too long');
			END IF;

			v_description := COALESCE(v_op->>'description', '');
			IF char_length(v_description) > 2000 THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'description too long');
			END IF;

			SELECT EXISTS(
				SELECT 1 FROM prsn_library_folders WHERE id = v_folder_id
			) INTO v_exists;
			IF v_exists THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'folder id already exists');
			END IF;

			SELECT COUNT(*)::int INTO v_folder_count
			FROM prsn_library_folders
			WHERE user_id = p_user_id;
			IF v_folder_count >= 500 THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'folder limit reached');
			END IF;

			INSERT INTO prsn_library_folders (id, user_id, title, description, created_at, updated_at)
			VALUES (v_folder_id, p_user_id, v_title, v_description, v_now, v_now);

			v_touched := array_append(v_touched, v_folder_id);

			IF v_op ? 'creation_ids' OR v_op ? 'creationIds' THEN
				SELECT ARRAY(
					SELECT DISTINCT x::bigint
					FROM jsonb_array_elements_text(COALESCE(v_op->'creation_ids', v_op->'creationIds', '[]'::jsonb)) AS t(x)
				) INTO v_creation_ids;
				IF coalesce(array_length(v_creation_ids, 1), 0) > 500 THEN
					RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'too many creation_ids');
				END IF;
				IF coalesce(array_length(v_creation_ids, 1), 0) > 0 THEN
					SELECT COUNT(*)::int INTO v_owned_count
					FROM prsn_created_images ci
					WHERE ci.user_id = p_user_id AND ci.id = ANY (v_creation_ids);
					IF v_owned_count <> array_length(v_creation_ids, 1) THEN
						RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'creation not owned');
					END IF;

					UPDATE prsn_library_folders f
					SET updated_at = v_now
					WHERE f.user_id = p_user_id
						AND f.id IN (
							SELECT i.folder_id
							FROM prsn_library_folder_items i
							WHERE i.user_id = p_user_id AND i.creation_id = ANY (v_creation_ids)
						);

					DELETE FROM prsn_library_folder_items
					WHERE user_id = p_user_id AND creation_id = ANY (v_creation_ids);

					FOREACH v_creation_id IN ARRAY v_creation_ids LOOP
						INSERT INTO prsn_library_folder_items (user_id, folder_id, creation_id, added_at)
						VALUES (p_user_id, v_folder_id, v_creation_id, v_now);
					END LOOP;
				END IF;
			END IF;

		ELSIF v_op_type = 'update' THEN
			BEGIN
				v_folder_id := (v_op->>'id')::uuid;
			EXCEPTION WHEN others THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'update.id must be a uuid');
			END;
			IF v_folder_id IS NULL THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'update.id is required');
			END IF;

			SELECT EXISTS(
				SELECT 1 FROM prsn_library_folders WHERE id = v_folder_id AND user_id = p_user_id
			) INTO v_exists;
			IF NOT v_exists THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'folder not found');
			END IF;

			IF v_op ? 'title' THEN
				v_title := trim(COALESCE(v_op->>'title', ''));
				IF v_title = '' THEN
					v_title := 'Untitled folder';
				END IF;
				IF char_length(v_title) > 200 THEN
					RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'title too long');
				END IF;
			ELSE
				SELECT title INTO v_title FROM prsn_library_folders WHERE id = v_folder_id;
			END IF;

			IF v_op ? 'description' THEN
				v_description := COALESCE(v_op->>'description', '');
				IF char_length(v_description) > 2000 THEN
					RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'description too long');
				END IF;
			ELSE
				SELECT description INTO v_description FROM prsn_library_folders WHERE id = v_folder_id;
			END IF;

			UPDATE prsn_library_folders
			SET title = v_title,
				description = v_description,
				updated_at = v_now
			WHERE id = v_folder_id AND user_id = p_user_id;

			v_touched := array_append(v_touched, v_folder_id);

		ELSIF v_op_type = 'delete' THEN
			BEGIN
				v_folder_id := (v_op->>'id')::uuid;
			EXCEPTION WHEN others THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'delete.id must be a uuid');
			END;
			IF v_folder_id IS NULL THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'delete.id is required');
			END IF;

			DELETE FROM prsn_library_folders
			WHERE id = v_folder_id AND user_id = p_user_id;
			IF NOT FOUND THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'folder not found');
			END IF;

		ELSIF v_op_type = 'move' THEN
			IF v_op ? 'folder_id' OR v_op ? 'folderId' THEN
				IF (v_op->>'folder_id') IS NULL AND (v_op->>'folderId') IS NULL THEN
					v_folder_id := NULL;
				ELSE
					BEGIN
						v_folder_id := COALESCE(v_op->>'folder_id', v_op->>'folderId')::uuid;
					EXCEPTION WHEN others THEN
						RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'move.folder_id must be a uuid or null');
					END;
				END IF;
			ELSE
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'move.folder_id is required (uuid or null)');
			END IF;

			IF v_folder_id IS NOT NULL THEN
				SELECT EXISTS(
					SELECT 1 FROM prsn_library_folders WHERE id = v_folder_id AND user_id = p_user_id
				) INTO v_exists;
				IF NOT v_exists THEN
					RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'folder not found');
				END IF;
			END IF;

			SELECT ARRAY(
				SELECT DISTINCT x::bigint
				FROM jsonb_array_elements_text(COALESCE(v_op->'creation_ids', v_op->'creationIds', '[]'::jsonb)) AS t(x)
			) INTO v_creation_ids;
			IF coalesce(array_length(v_creation_ids, 1), 0) < 1 THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'move.creation_ids required');
			END IF;
			IF array_length(v_creation_ids, 1) > 500 THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'too many creation_ids');
			END IF;

			SELECT COUNT(*)::int INTO v_owned_count
			FROM prsn_created_images ci
			WHERE ci.user_id = p_user_id AND ci.id = ANY (v_creation_ids);
			IF v_owned_count <> array_length(v_creation_ids, 1) THEN
				RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'creation not owned');
			END IF;

			-- Touch folders that lose members.
			SELECT ARRAY(
				SELECT DISTINCT i.folder_id
				FROM prsn_library_folder_items i
				WHERE i.user_id = p_user_id AND i.creation_id = ANY (v_creation_ids)
			) INTO v_touched;

			DELETE FROM prsn_library_folder_items
			WHERE user_id = p_user_id AND creation_id = ANY (v_creation_ids);

			IF v_folder_id IS NOT NULL THEN
				FOREACH v_creation_id IN ARRAY v_creation_ids LOOP
					INSERT INTO prsn_library_folder_items (user_id, folder_id, creation_id, added_at)
					VALUES (p_user_id, v_folder_id, v_creation_id, v_now);
				END LOOP;
				v_touched := array_append(v_touched, v_folder_id);
			END IF;

			IF coalesce(array_length(v_touched, 1), 0) > 0 THEN
				UPDATE prsn_library_folders
				SET updated_at = v_now
				WHERE user_id = p_user_id AND id = ANY (v_touched);
			END IF;

		ELSE
			RETURN jsonb_build_object('ok', false, 'error', 'validation', 'message', 'unknown operation');
		END IF;
	END LOOP;

	UPDATE prsn_library_folder_sync
	SET revision = revision + 1,
		updated_at = v_now
	WHERE user_id = p_user_id
	RETURNING revision INTO v_revision;

	RETURN jsonb_build_object(
		'ok', true,
		'revision', v_revision,
		'folders', prsn_library_folders_snapshot_folders(p_user_id)
	);
END;
$$;

COMMENT ON FUNCTION prsn_library_folders_mutate(bigint, bigint, jsonb) IS 'Parascene: atomic Library folder mutate with revision CAS.';

REVOKE ALL ON FUNCTION prsn_library_folders_snapshot_folders(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prsn_library_folders_get_snapshot(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION prsn_library_folders_mutate(bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prsn_library_folders_snapshot_folders(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION prsn_library_folders_get_snapshot(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION prsn_library_folders_mutate(bigint, bigint, jsonb) TO service_role;
