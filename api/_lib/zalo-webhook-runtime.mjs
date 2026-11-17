import { createFirestoreLinkStore, getLiveZaloDatabase } from './zalo-runtime.mjs';
import { createZaloWithdrawalService, keptZaloOtpSends, zaloRevocationPath } from '../../miniapp/server/zalo-withdrawal.mjs';

// Scan one indexed identity field and delete only matching Zalo integration data.
// Each page is rechecked inside a transaction to preserve changes made concurrently.
export function createFirestoreWithdrawalStore(db) {
  return {
    ...createFirestoreLinkStore(db),
    async cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff, at }) {
      const { FieldPath } = await import('firebase-admin/firestore');
      for (const collection of ['zalo_link_sessions', 'zalo_link_claims', 'zalo_link_challenges']) {
        let cursor;
        for (;;) {
          let query = db.collection(collection).where('zaloUserId', '==', zaloUserId)
            .orderBy(FieldPath.documentId()).limit(100);
          if (cursor) query = query.startAfter(cursor);
          const page = await query.get();
          if (page.empty) break;
          await db.runTransaction(async transaction => {
            const [currentLink, ...documents] = await transaction.getAll(
              db.doc(`zalo_links/${appId}_${zaloUserId}`), ...page.docs.map(document => document.ref));
            const challengeRefs = collection === 'zalo_link_claims' ? documents.map(document => document.data()?.challengeId)
              .filter(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))
              .map(id => db.doc(`zalo_link_challenges/${id}`)) : [];
            const challenges = challengeRefs.length ? await transaction.getAll(...challengeRefs) : [];
            const challengeData = new Map(challenges.map(document => [document.id, document.exists ? document.data() : null]));
            const link = currentLink.exists ? currentLink.data() : null;
            const freshLink = link?.appId === appId && link.miniAppId === miniAppId
              && link.zaloUserId === zaloUserId && Number.isSafeInteger(link.linkedAt) && link.linkedAt > cutoff;
            for (const document of documents) {
              const record = document.exists ? document.data() : null;
              const challenge = collection === 'zalo_link_claims' ? challengeData.get(record?.challengeId) : null;
              const eligibleClaim = challenge?.appId === appId && challenge.miniAppId === miniAppId
                && challenge.zaloUserId === zaloUserId && Number.isSafeInteger(challenge.createdAt)
                && challenge.createdAt > cutoff;
              if (record?.appId === appId && record.miniAppId === miniAppId
                && record.zaloUserId === zaloUserId
                && (!Number.isSafeInteger(record.createdAt) || record.createdAt <= cutoff
                  || (collection === 'zalo_link_claims' && !eligibleClaim) || (collection === 'zalo_link_sessions'
                  && (!freshLink || record.linkVersion !== link.version)))) transaction.delete(document.ref);
            }
          });
          cursor = page.docs.at(-1).id;
          if (page.size < 100) break;
        }
      }
      // The e-mail code document is keyed by this Zalo user and names the school
      // address and uid the code was sent to. A code requested up to the cutoff,
      // or a retired one (only its send history is left), is deleted, so no
      // address, uid or code hash outlives the withdrawal; a code requested after
      // fresh consent stays. Its send times of the last day move onto the
      // hashed withdrawal marker first: dropping them would restart this Zalo
      // user's send caps after every withdrawal and fresh consent. The
      // per-account counters (zalo_link_otp_limits, zalo_link_rate_limits) hold
      // no Zalo identity and stay.
      const otpRef = db.doc(`zalo_link_otps/${appId}_${zaloUserId}`);
      const markerRef = db.doc(zaloRevocationPath(appId, miniAppId, zaloUserId));
      await db.runTransaction(async transaction => {
        const [otp, marker] = await transaction.getAll(otpRef, markerRef);
        const record = otp.exists ? otp.data() : null;
        if (!(record?.appId === appId && record.miniAppId === miniAppId && record.zaloUserId === zaloUserId
          && (!Number.isSafeInteger(record.createdAt) || record.createdAt <= cutoff))) return;
        const current = marker.exists ? marker.data() : null;
        if (current?.appId === appId && current.miniAppId === miniAppId && Number.isSafeInteger(current.withdrawnAt)) {
          transaction.set(markerRef, { ...current, otpSentAt: keptZaloOtpSends([current.otpSentAt, record.sentAt], at) });
        }
        transaction.delete(otpRef);
      });
    },
  };
}

export async function getLiveZaloWithdrawalService(env = process.env) {
  const db = await getLiveZaloDatabase(env);
  return createZaloWithdrawalService({
    store: createFirestoreWithdrawalStore(db),
    appId: env.ZALO_APP_ID,
    miniAppId: env.ZALO_MINI_APP_ID,
    apiKey: env.ZALO_MINI_APP_API_KEY,
  });
}
