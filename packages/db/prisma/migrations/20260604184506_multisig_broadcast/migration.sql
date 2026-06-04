-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "treasury_key_hash" TEXT;

-- AlterTable
ALTER TABLE "multisig_action" ADD COLUMN     "policy_id" UUID,
ADD COLUMN     "recipient" TEXT;

-- CreateTable
CREATE TABLE "treasury_policy" (
    "id" UUID NOT NULL,
    "script_hash" TEXT NOT NULL,
    "script_cbor" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "required" INTEGER NOT NULL,
    "member_key_hashes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "treasury_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "treasury_policy_script_hash_key" ON "treasury_policy"("script_hash");
