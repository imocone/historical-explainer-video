import { buildImageRequests as buildSegmentedRequests } from "../opposed-opener/asset-contract.mjs";

export const buildImageRequests = options => buildSegmentedRequests({...options, expectedTemplateId:"glass-opener"});
export const compileOpenerRequests = options => buildImageRequests(options).map(({request}) => request);
