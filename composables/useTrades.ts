import type { DocumentNode } from 'graphql'
import { addSeconds, subSeconds } from 'date-fns'
import swapsList from '@/queries/subsquid/general/swapsList.graphql'
import offersList from '@/queries/subsquid/general/offersList.graphql'
import { BLOCKS_PER_HOUR } from '@/composables/transaction/transactionOffer'
import {
  type Offer,
  type Swap,
  type BaseTrade,
  type TradeNftItem,
  TradeType,
  TradeDesiredTokenType,
} from '@/components/trade/types'

type CollectionWithTokenOwners = {
  id: string
  nfts: {
    id: string
    currentOwner: string
  }[]
}

export const TRADES_QUERY_MAP: Record<TradeType, { queryDocument: DocumentNode, dataKey: string }> = {
  [TradeType.SWAP]: {
    queryDocument: swapsList,
    dataKey: 'swaps',
  },
  [TradeType.OFFER]: {
    queryDocument: offersList,
    dataKey: 'offers',
  },
}

const SECONDS_PER_BLOCK = 3600 / BLOCKS_PER_HOUR

const currentBlock = ref(0)

export type UseTradesParams = {
  where?: MaybeRef<Record<string, unknown> | string>
  limit?: number
  disabled?: ComputedRef<boolean>
  type?: TradeType
  minimal?: boolean
  orderBy?: string[]
}

export default function ({
  where = {},
  limit = 100,
  disabled = computed(() => false),
  type = TradeType.SWAP,
  minimal = false,
  orderBy = ['blockNumber_DESC'],
}: UseTradesParams) {
  const { queryDocument, dataKey } = TRADES_QUERY_MAP[type]

  const items = ref<TradeNftItem[]>([])
  const targetsOfTrades = ref<Map<string, string[]>>()
  const ownersSubscription = ref(() => { })

  const { client } = usePrefix()

  const {
    result: data,
    loading: fetching,
    refetch,
  } = useQuery<{ offers: Offer[] } | { swpas: Swap[] }>(
    queryDocument,
    computed(() => ({
      where: unref(where),
      limit: limit,
      orderBy: orderBy,
    })),
    computed(() => ({
      enabled: !disabled.value,
      clientId: client.value,
    })),
  )

  const getCurrentBlock = async () => {
    const api = await useApi().apiInstance.value
    const { number } = await api.rpc.chain.getHeader()
    return number.toNumber()
  }

  if (!currentBlock.value) {
    getCurrentBlock().then(b => currentBlock.value = b)
  }

  const dataItems = computed<Offer[] | Swap[]>(() => data.value?.[dataKey] || [])
  const hasTargetsOfTrades = computed(() => Boolean(targetsOfTrades.value?.size))
  const tradeKeys = computed<string>(() => dataItems.value.map(item => item.id).join('-'))
  const needsToSubscribe = computed(() => minimal ? false : !hasTargetsOfTrades.value)
  const loading = computed(() => !currentBlock.value || fetching.value || needsToSubscribe.value)

  const subscribeToTargetsOfTrades = (trades: BaseTrade[]) => {
    ownersSubscription.value = useSubscriptionGraphql<{ collections: CollectionWithTokenOwners[] }>({
      query: `
        collections: collectionEntities(where: {
          id_in: ${JSON.stringify(trades.map(item => item.considered.id))}
        }) {
          id
          nfts {
            id
            currentOwner
          }
        }
      `,
      onChange: ({ data: { collections } }) => {
        const map = new Map()

        const collectionMap: Record<string, CollectionWithTokenOwners['nfts']> = Object.fromEntries(
          collections.map(collection => [collection.id, collection.nfts]),
        )

        trades.forEach((trade) => {
          const tradeDesired = trade.desired
          map.set(trade.id,
            tradeDesired
              ? [collectionMap[tradeDesired.collection.id].find(nft => nft.id === tradeDesired.id)?.currentOwner]
              : collectionMap[trade.considered.id].map(nft => nft.currentOwner),
          )
        })

        targetsOfTrades.value = map
      },
    })
  }

  if (!minimal) {
    watch(tradeKeys, (key) => {
      if (key) {
        ownersSubscription.value()
        targetsOfTrades.value = undefined
        subscribeToTargetsOfTrades(dataItems.value)
      }
    })
  }

  watchEffect(() => {
    if (needsToSubscribe.value || !currentBlock.value) {
      return
    }

    items.value = dataItems.value.map((trade) => {
      const desiredType = trade.desired ? TradeDesiredTokenType.SPECIFIC : TradeDesiredTokenType.ANY_IN_COLLECTION

      return {
        ...trade,
        expirationDate: addSeconds(new Date(), ((Number(trade.expiration) - currentBlock.value) * SECONDS_PER_BLOCK)),
        offered: trade.nft,
        desiredType: desiredType,
        isAnyTokenInCollectionDesired: desiredType === TradeDesiredTokenType.ANY_IN_COLLECTION,
        type,
        targets: targetsOfTrades.value?.get(trade.id) || [],
        createdAt: subSeconds(new Date(), ((currentBlock.value - Number(trade.blockNumber)) * SECONDS_PER_BLOCK)),
      } as TradeNftItem
    })
  })

  return {
    items,
    loading,
    refetch,
  }
}
