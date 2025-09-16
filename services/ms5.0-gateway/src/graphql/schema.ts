import { makeExecutableSchema } from '@graphql-tools/schema';
import { DateTimeResolver, JSONResolver } from 'graphql-scalars';
import { shield, allow, rule } from 'graphql-shield';
import { applyMiddleware } from 'graphql-middleware';

const typeDefs = `
  scalar DateTime
  scalar JSON

  enum Role {
    ADMIN
    MANAGER
    SUPERVISOR
    OPERATOR
    VIEWER
  }

  enum ActionType {
    SAFETY
    QUALITY
    DELIVERY
    COST
    PEOPLE
  }

  enum ActionStatus {
    OPEN
    IN_PROGRESS
    COMPLETED
    OVERDUE
  }

  enum AssetStatus {
    RUNNING
    IDLE
    STOPPED
    MAINTENANCE
    ERROR
  }

  enum Severity {
    INFO
    WARNING
    CRITICAL
  }

  type User {
    id: ID!
    email: String!
    name: String!
    roles: [Role!]!
    siteId: ID
    lineIds: [ID!]
  }

  type Site {
    id: ID!
    name: String!
    code: String!
    areas: [Area!]!
    metrics: SiteMetrics
  }

  type Area {
    id: ID!
    siteId: ID!
    name: String!
    lines: [Line!]!
  }

  type Line {
    id: ID!
    areaId: ID!
    name: String!
    assets: [Asset!]!
    currentOrder: Order
    oee: OEEData
    tierBoard: TierBoard
  }

  type Asset {
    id: ID!
    lineId: ID!
    name: String!
    type: String!
    status: AssetStatus!
    telemetry: AssetTelemetry
    events(limit: Int): [Event!]!
  }

  type Product {
    id: ID!
    code: String!
    name: String!
    specifications: JSON
  }

  type Order {
    id: ID!
    orderNumber: String!
    productId: ID!
    product: Product
    targetQuantity: Int!
    completedQuantity: Int!
    startTime: DateTime
    endTime: DateTime
  }

  type TierBoard {
    id: ID!
    lineId: ID!
    date: DateTime!
    shift: String!
    actions(status: ActionStatus): [Action!]!
    kpis: [KPI!]!
  }

  type Action {
    id: ID!
    tierBoardId: ID
    type: ActionType!
    description: String!
    owner: String!
    dueDate: DateTime!
    status: ActionStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type KPI {
    id: ID!
    name: String!
    value: Float!
    target: Float!
    unit: String
    trend: [Float!]
  }

  type OEEData {
    oee: Float!
    availability: Float!
    performance: Float!
    quality: Float!
    timestamp: DateTime!
  }

  type AssetTelemetry {
    assetId: ID!
    timestamp: DateTime!
    oee: Float
    runtime: Float
    downtime: Float
    goodCount: Int
    rejectCount: Int
    temperature: Float
    pressure: Float
    vibration: Float
  }

  type Event {
    id: ID!
    assetId: ID!
    timestamp: DateTime!
    type: String!
    severity: Severity!
    description: String!
    metadata: JSON
  }

  type Loss {
    id: ID!
    lineId: ID!
    timestamp: DateTime!
    category: String!
    reason: String!
    duration: Float!
    impact: Float!
  }

  type SPCSample {
    id: ID!
    productId: ID!
    characteristic: String!
    value: Float!
    ucl: Float!
    lcl: Float!
    target: Float!
    timestamp: DateTime!
  }

  type Andon {
    id: ID!
    lineId: ID!
    stationId: String!
    type: String!
    status: String!
    triggeredAt: DateTime!
    respondedAt: DateTime
    resolvedAt: DateTime
    escalationLevel: Int
  }

  type Permit {
    id: ID!
    type: String!
    area: String!
    status: String!
    requestedBy: String!
    approvedBy: String
    validFrom: DateTime!
    validTo: DateTime!
  }

  type SiteMetrics {
    oee: Float!
    availability: Float!
    performance: Float!
    quality: Float!
    safetyIncidents: Int!
    openActions: Int!
  }

  type Query {
    # User
    me: User
    users: [User!]!

    # Master Data
    sites: [Site!]!
    site(id: ID!): Site
    areas(siteId: ID!): [Area!]!
    lines(areaId: ID!): [Line!]!
    assets(lineId: ID!): [Asset!]!
    asset(id: ID!): Asset
    products: [Product!]!
    orders(lineId: ID): [Order!]!

    # DMS
    tierBoards(lineId: ID, date: DateTime): [TierBoard!]!
    actions(status: ActionStatus, type: ActionType): [Action!]!

    # Analytics
    oee(lineId: ID!, from: DateTime!, to: DateTime!): [OEEData!]!
    losses(lineId: ID!, from: DateTime!, to: DateTime!): [Loss!]!

    # Quality
    spcSamples(productId: ID!, characteristic: String): [SPCSample!]!

    # Andon
    andons(lineId: ID, status: String): [Andon!]!

    # Safety
    permits(status: String): [Permit!]!
  }

  type Mutation {
    # Actions
    createAction(input: CreateActionInput!): Action!
    updateAction(id: ID!, input: UpdateActionInput!): Action!

    # Andon
    triggerAndon(input: TriggerAndonInput!): Andon!
    respondAndon(id: ID!): Andon!
    resolveAndon(id: ID!, resolution: String!): Andon!

    # Permits
    requestPermit(input: RequestPermitInput!): Permit!
    approvePermit(id: ID!): Permit!
  }

  type Subscription {
    # Real-time updates
    assetTelemetry(assetId: ID!): AssetTelemetry!
    andonTriggered(lineId: ID): Andon!
    actionCreated(lineId: ID): Action!
  }

  input CreateActionInput {
    tierBoardId: ID
    type: ActionType!
    description: String!
    owner: String!
    dueDate: DateTime!
  }

  input UpdateActionInput {
    description: String
    owner: String
    dueDate: DateTime
    status: ActionStatus
  }

  input TriggerAndonInput {
    lineId: ID!
    stationId: String!
    type: String!
    description: String
  }

  input RequestPermitInput {
    type: String!
    area: String!
    validFrom: DateTime!
    validTo: DateTime!
    description: String!
  }
`;

const resolvers = {
  DateTime: DateTimeResolver,
  JSON: JSONResolver,

  Query: {
    me: async (_parent: any, _args: any, context: any) => {
      return context.user;
    },

    sites: async (_parent: any, _args: any, context: any) => {
      return context.dataSources.masterData.getSites();
    },

    site: async (_parent: any, args: any, context: any) => {
      return context.dataSources.masterData.getSite(args.id);
    },

    tierBoards: async (_parent: any, args: any, context: any) => {
      return context.dataSources.dms.getTierBoards(args);
    },

    actions: async (_parent: any, args: any, context: any) => {
      return context.dataSources.dms.getActions(args);
    },

    oee: async (_parent: any, args: any, context: any) => {
      return context.dataSources.analytics.getOEE(args);
    },

    losses: async (_parent: any, args: any, context: any) => {
      return context.dataSources.analytics.getLosses(args);
    },

    andons: async (_parent: any, args: any, context: any) => {
      return context.dataSources.andon.getAndons(args);
    },
  },

  Mutation: {
    createAction: async (_parent: any, args: any, context: any) => {
      return context.dataSources.dms.createAction(args.input);
    },

    updateAction: async (_parent: any, args: any, context: any) => {
      return context.dataSources.dms.updateAction(args.id, args.input);
    },

    triggerAndon: async (_parent: any, args: any, context: any) => {
      return context.dataSources.andon.triggerAndon(args.input);
    },

    respondAndon: async (_parent: any, args: any, context: any) => {
      return context.dataSources.andon.respondAndon(args.id);
    },

    resolveAndon: async (_parent: any, args: any, context: any) => {
      return context.dataSources.andon.resolveAndon(args.id, args.resolution);
    },
  },

  Site: {
    areas: async (parent: any, _args: any, context: any) => {
      return context.dataSources.masterData.getAreas(parent.id);
    },

    metrics: async (parent: any, _args: any, context: any) => {
      return context.dataSources.analytics.getSiteMetrics(parent.id);
    },
  },

  Line: {
    assets: async (parent: any, _args: any, context: any) => {
      return context.dataSources.masterData.getAssets(parent.id);
    },

    oee: async (parent: any, _args: any, context: any) => {
      return context.dataSources.analytics.getCurrentOEE(parent.id);
    },

    tierBoard: async (parent: any, _args: any, context: any) => {
      return context.dataSources.dms.getCurrentTierBoard(parent.id);
    },
  },

  Asset: {
    telemetry: async (parent: any, _args: any, context: any) => {
      return context.dataSources.telemetry.getLatestTelemetry(parent.id);
    },

    events: async (parent: any, args: any, context: any) => {
      return context.dataSources.telemetry.getEvents(parent.id, args.limit);
    },
  },
};

const isAuthenticated = rule()((parent, args, context) => {
  return context.user !== null;
});

const hasRole = (role: string) => rule()((parent, args, context) => {
  return context.user?.roles?.includes(role);
});

const permissions = shield({
  Query: {
    '*': isAuthenticated,
    me: isAuthenticated,
  },
  Mutation: {
    createAction: hasRole('SUPERVISOR'),
    updateAction: hasRole('SUPERVISOR'),
    triggerAndon: isAuthenticated,
    respondAndon: hasRole('SUPERVISOR'),
    resolveAndon: hasRole('SUPERVISOR'),
    requestPermit: isAuthenticated,
    approvePermit: hasRole('MANAGER'),
  },
}, {
  allowExternalErrors: true,
  fallbackRule: allow,
});

const baseSchema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

export const schema = applyMiddleware(baseSchema, permissions);