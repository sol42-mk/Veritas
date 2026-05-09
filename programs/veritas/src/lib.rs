use anchor_lang::prelude::*;

declare_id!("4qBS9B7cZ5r4CeNMaRvxELmZugRroXUwRg8Ss4MP3CVi");

#[program]
pub mod veritas {
    use super::*;

    // Called once per video by the journalist portal.
    // Writes an immutable registration record to a PDA derived
    // from the watermark_id, so lookups are O(1) by ID.
    pub fn register_video(
        ctx: Context<RegisterVideo>,
        watermark_id: String,
        video_hash: String,
        source_id: String,
        source_name: String,
    ) -> Result<()> {
        let record = &mut ctx.accounts.video_record;
        record.watermark_id = watermark_id;
        record.video_hash = video_hash;
        record.source_id = source_id;
        record.source_name = source_name;
        record.timestamp = Clock::get()?.unix_timestamp;
        record.registered_by = ctx.accounts.authority.key();
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(watermark_id: String)]
pub struct RegisterVideo<'info> {
    // PDA derived from watermark_id — unique per video
    #[account(
        init,
        payer = authority,
        space = VideoRecord::space(&watermark_id),
        seeds = [b"video", watermark_id.as_bytes()],
        bump
    )]
    pub video_record: Account<'info, VideoRecord>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct VideoRecord {
    pub watermark_id: String,  // UUID embedded in video metadata
    pub video_hash: String,    // SHA-256 of original file
    pub source_id: String,     // e.g. "kanal5"
    pub source_name: String,   // e.g. "Канал 5"
    pub timestamp: i64,        // Unix timestamp of registration
    pub registered_by: Pubkey, // Wallet that registered it
}

impl VideoRecord {
    pub fn space(_watermark_id: &str) -> usize {
        8           // discriminator
        + 4 + 36    // watermark_id (UUID string)
        + 4 + 64    // video_hash (SHA-256 hex)
        + 4 + 32    // source_id
        + 4 + 64    // source_name
        + 8         // timestamp
        + 32        // registered_by pubkey
        + 16        // padding
    }
}
