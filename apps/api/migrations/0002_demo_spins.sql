CREATE TABLE IF NOT EXISTS demo_spin_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_id text NOT NULL REFERENCES prizes(id),
  prize_label text NOT NULL,
  target_segment integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_spin_results_created_idx ON demo_spin_results(created_at DESC);
