#pragma once
// Copy to ignored CloudConfig.h; never commit real device keys or pairing keys.
// No trailing slash. Provision a DIFFERENT device key for each arm.
#define CLOUD_API_BASE "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
#define CLOUD_DEVICE_KEY ""
// PEM trust anchor for the configured host. Verify chain on deployment, and
// rotate this anchor before expiry. Empty means cloud control stays disabled.
#define CLOUD_ROOT_CA ""
// Identical nonzero uint32 pair ID on both boards, opposite board's STA MAC.
#define CLOUD_PAIR_ID 0UL
#define CLOUD_PEER_MAC {0,0,0,0,0,0}
// Provision random 16-byte keys on both boards, identical within this pair.
#define CLOUD_ESPNOW_PMK {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}
#define CLOUD_ESPNOW_LMK {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}
