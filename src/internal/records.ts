// The node API client's answers, from the JSON form the Rust client writes to typed records.
//
// The Rust client (`iceroot-sdk-api` with its `serde` feature) writes every integer that can
// exceed 2^53 as a decimal string. `Json<T>` is the shape of `T` in that form, so the compiler
// checks that each converter turns every such string into a `bigint` and leaves nothing out.

import { AssetId } from "../amount.js";
import type {
  AccountInfo,
  BlockInfo,
  CryptoConfiguration,
  FeeStatistics,
  NodeConfiguration,
  NodeStatus,
  Page,
  ResolvedName,
  RoundValidator,
  SubmitReport,
  Supply,
  Timestamp,
  TxDetails,
  TxRecord,
  MissedSlot,
  ValidatorInfo,
} from "../client.js";

/** `T` as the Rust client writes it: every `bigint` a decimal string. */
export type Json<T> = T extends bigint
  ? string
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? readonly Json<U>[]
      : { readonly [K in keyof T]: Json<T[K]> };

const big = (text: string): bigint => BigInt(text);

/** `{ [key]: convert(value) }`, or nothing when the value is absent. */
function maybe<K extends string, A, B>(key: K, value: A | undefined, convert: (value: A) => B): { readonly [P in K]?: B } {
  return (value === undefined ? {} : { [key]: convert(value) }) as { readonly [P in K]?: B };
}

const same = <A>(value: A): A => value;

export function timestamp(json: Json<Timestamp>): Timestamp {
  return { chain: big(json.chain), unix: big(json.unix) };
}

export function page<W, T>(json: Json<Page<W>>, item: (json: Json<W>) => T): Page<T> {
  return {
    items: json.items.map((each) => item(each as Json<W>)),
    page: json.page,
    pageCount: json.pageCount,
    total: big(json.total),
    totalIsEstimate: json.totalIsEstimate,
    hasNext: json.hasNext,
  };
}

export function nodeStatus(json: Json<NodeStatus>): NodeStatus {
  return {
    height: big(json.height),
    synced: json.synced,
    blocksBehind: big(json.blocksBehind),
    chainTime: big(json.chainTime),
  };
}

export function nodeConfiguration(json: Json<NodeConfiguration>): NodeConfiguration {
  return {
    coreVersion: json.coreVersion,
    network: json.network,
    token: json.token,
    ...maybe("explorer", json.explorer, same),
    seats: json.seats,
    blockTime: json.blockTime,
    milestoneJson: json.milestoneJson,
    pool: json.pool,
    poolFees: {
      dynamic: json.poolFees.dynamic,
      minFeePool: big(json.poolFees.minFeePool),
      minFeeBroadcast: big(json.poolFees.minFeeBroadcast),
      addonBytes: json.poolFees.addonBytes.map(({ bytes, ...kind }) => ({ ...kind, bytes: big(bytes) })),
    },
  };
}

export function cryptoConfiguration(json: Json<CryptoConfiguration>): CryptoConfiguration {
  return json;
}

export function supply(json: Json<Supply>): Supply {
  return {
    height: big(json.height),
    blockId: json.blockId,
    supply: big(json.supply),
    burned: {
      fees: big(json.burned.fees),
      transactions: big(json.burned.transactions),
      total: big(json.burned.total),
    },
  };
}

export function feeStatistics(json: Json<FeeStatistics>): FeeStatistics {
  return {
    ...maybe("days", json.days, same),
    entries: json.entries.map(({ avg, min, max, sum, burned, ...kind }) => ({
      ...kind,
      avg: big(avg),
      min: big(min),
      max: big(max),
      sum: big(sum),
      burned: big(burned),
    })),
  };
}

export function account(json: Json<AccountInfo>): AccountInfo {
  return {
    address: json.address,
    ...maybe("publicKey", json.publicKey, same),
    nonce: big(json.nonce),
    balances: json.balances.map(({ asset, amount }) => ({ asset: asset as AssetId, amount: big(amount) })),
    vote: json.vote,
    ...maybe("secondPublicKey", json.secondPublicKey, same),
    ...maybe("validatorName", json.validatorName, same),
  };
}

function details(json: Json<TxDetails>): TxDetails {
  switch (json.kind) {
    case "transfer":
      return {
        kind: "transfer",
        recipients: json.recipients.map(({ address, amount }) => ({ address, amount: big(amount) })),
      };
    case "burn":
      return { kind: "burn", amount: big(json.amount) };
    default:
      return json;
  }
}

export function transaction(json: Json<TxRecord>): TxRecord {
  return {
    id: json.id,
    status: json.status,
    ...maybe("block", json.block, (block) => ({
      id: block.id,
      height: big(block.height),
      confirmations: big(block.confirmations),
      ...maybe("time", block.time, timestamp),
    })),
    ...maybe("direction", json.direction, same),
    sender: json.sender,
    senderPublicKey: json.senderPublicKey,
    nonce: big(json.nonce),
    fee: big(json.fee),
    ...maybe("burnedFee", json.burnedFee, big),
    ...maybe("memo", json.memo, same),
    secondSigned: json.secondSigned,
    version: json.version,
    details: details(json.details),
  };
}

export function resolvedName(json: Json<ResolvedName>): ResolvedName {
  return json;
}

export function validator(json: Json<ValidatorInfo>): ValidatorInfo {
  const production = json.production;
  return {
    name: json.name,
    address: json.address,
    publicKey: json.publicKey,
    ...maybe("rank", json.rank, same),
    status: json.status,
    voteWeight: big(json.voteWeight),
    voteShareBasisPoints: json.voteShareBasisPoints,
    voters: big(json.voters),
    production: {
      produced: big(production.produced),
      missed: big(production.missed),
      ...maybe("productivityBasisPoints", production.productivityBasisPoints, same),
      ...maybe("lastBlock", production.lastBlock, (last) => ({
        id: last.id,
        ...maybe("height", last.height, big),
        ...maybe("time", last.time, timestamp),
      })),
    },
    earnings: {
      rewards: big(json.earnings.rewards),
      fees: big(json.earnings.fees),
      burnedFees: big(json.earnings.burnedFees),
      donations: big(json.earnings.donations),
      total: big(json.earnings.total),
    },
    ...maybe("version", json.version, same),
  };
}

export function block(json: Json<BlockInfo>): BlockInfo {
  return {
    id: json.id,
    height: big(json.height),
    version: json.version,
    ...maybe("previous", json.previous, same),
    ...maybe("producerName", json.producerName, same),
    producerPublicKey: json.producerPublicKey,
    reward: big(json.reward),
    donations: json.donations.map(({ address, amount }) => ({ address, amount: big(amount) })),
    totalFee: big(json.totalFee),
    burnedFee: big(json.burnedFee),
    totalAmount: big(json.totalAmount),
    producerEarned: big(json.producerEarned),
    transactionCount: json.transactionCount,
    payloadHash: json.payloadHash,
    payloadLength: json.payloadLength,
    signature: json.signature,
    confirmations: big(json.confirmations),
    time: timestamp(json.time),
  };
}

export function missedSlot(json: Json<MissedSlot>): MissedSlot {
  return { height: big(json.height), time: timestamp(json.time), validator: json.validator };
}

export function roundValidator(json: Json<RoundValidator>): RoundValidator {
  return { publicKey: json.publicKey, voteWeight: big(json.voteWeight) };
}

export function submitReport(json: Json<SubmitReport>): SubmitReport {
  return json;
}

/** `convert`, or `null` for the JSON `null` of a lookup that found nothing. */
export function orNull<W, T>(convert: (json: W) => T): (json: W | null) => T | null {
  return (json) => (json === null ? null : convert(json));
}

/** The balance of `asset` (ROOT unless given) in an account the node reported; 0 when it holds none. */
export function balanceOf(account: AccountInfo, asset: AssetId = AssetId.ROOT): bigint {
  return account.balances.find((balance) => balance.asset === asset)?.amount ?? 0n;
}
