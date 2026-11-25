-- solved.ac tiers reach 12 characters ("Platinum III"); V27 allowed only 10.
ALTER TABLE solutions ALTER COLUMN difficulty_label TYPE VARCHAR(20);
