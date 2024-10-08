import { existentialDeposit } from '@kodadot1/static'
import { encodeAddress } from '@polkadot/util-crypto'
import type { ActionBuy } from './types'
import { verifyRoyalty } from './utils'
import { payRoyaltyTx, somePercentFromTX } from '@/utils/support'
import { getApiCall } from '@/utils/gallery/abstractCalls'
import { isLegacy, tokenIdToRoute } from '@/components/unique/utils'

const getFallbackAddress = () => {
  const { chainProperties } = useChain()
  const FALBACK_ROYALTY_RECIPIENT = KODADOT_DAO

  return encodeAddress(
    FALBACK_ROYALTY_RECIPIENT,
    chainProperties.value.ss58Format,
  )
}

async function payRoyaltyAssetHub(
  legacy,
  api,
  price,
  royalty,
  collectionId,
  tokenId,
) {
  const { isValid, normalizedRoyalty } = verifyRoyalty(royalty)

  const { urlPrefix } = usePrefix()

  if (!isValid) {
    return
  }

  const balanceOfRoyaltyReceiver = BigInt(
    await getNativeBalance({
      address: normalizedRoyalty.address,
      api,
    }),
  )

  const royaltyAmount = BigInt(royaltyFee(price, normalizedRoyalty.amount))

  const accountBalanceWithRoyalty = balanceOfRoyaltyReceiver + royaltyAmount

  const targetExistentialDeposit = BigInt(existentialDeposit[urlPrefix.value])

  const receiverAddress
    = accountBalanceWithRoyalty >= targetExistentialDeposit
      ? normalizedRoyalty.address
      : getFallbackAddress()

  return legacy
    ? payRoyaltyTx(api, price, normalizedRoyalty)
    : api.tx.nfts.payTips([
      {
        collection: collectionId,
        item: tokenId,
        receiver: receiverAddress,
        amount: royaltyAmount,
      },
    ])
}

async function execBuyStatemine(item: ActionBuy, api, executeTransaction) {
  const nfts = Array.isArray(item.nfts) ? item.nfts : [item.nfts]
  const transactions = await Promise.all(
    nfts.map(async ({ id: nftId, price, royalty }) => {
      const legacy = isLegacy(nftId)
      const { id: collectionId, item: tokenId } = tokenIdToRoute(nftId)
      const cb = getApiCall(api, item.urlPrefix, item.interaction, legacy)
      const arg = [collectionId, tokenId, price]

      const extrinsics = [cb(...arg), somePercentFromTX(api, price)]

      const royaltyExtrinsic = await payRoyaltyAssetHub(
        legacy,
        api,
        price,
        royalty,
        collectionId,
        tokenId,
      )
      if (royaltyExtrinsic) {
        extrinsics.push(royaltyExtrinsic)
      }

      return extrinsics
    }),
  )

  executeTransaction({
    cb: api.tx.utility.batchAll,
    arg: [transactions.flat()],
    successMessage: item.successMessage,
    errorMessage: item.errorMessage,
  })
}

export async function execBuyTx(item: ActionBuy, api, executeTransaction) {
  // item.urlPrefix === 'ahr'
  if (item.urlPrefix === 'ahk' || item.urlPrefix === 'ahp') {
    await execBuyStatemine(item, api, executeTransaction)
  }
}
