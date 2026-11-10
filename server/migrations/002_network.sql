-- A project and its ownership proof belong to one chain.
ALTER TABLE projects ADD COLUMN network TEXT NOT NULL DEFAULT 'sepolia' CHECK (network IN ('sepolia', 'mainnet'));
ALTER TABLE name_challenges ADD COLUMN network TEXT NOT NULL DEFAULT 'sepolia' CHECK (network IN ('sepolia', 'mainnet'));
