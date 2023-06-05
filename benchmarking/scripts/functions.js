// SPDX-License-Identifier: Apache-2.0

const {
  initialize,
  mint,
  declare,
  deploy,
  transfer,
} = require("../../tests/build/util/starknet");

module.exports = {
  rpcMethods,
  executeERC20Transfer,
};

function rpcMethods(userContext, events, done) {
  const data = { id: 1, jsonrpc: "2.0", method: "rpc_methods" };
  // set the "data" variable for the virtual user to use in the subsequent action
  userContext.vars.data = data;
  return done();
}

async function executeERC20Transfer(userContext, events, done) {
  const { nonce } = userContext.vars;
  const contractAddress =
    "0x0000000000000000000000000000000000000000000000000000000000000001";
  const amount =
    "0x0000000000000000000000000000000000000000000000000000000000000001";

  // TODO: Once declare bug fixed we can call _setupToken and remove hardcoded address

  transfer(
    userContext.api,
    contractAddress,
    "0x040e59c2c182a58fb0a74349bfa4769cbbcba32547591dd3fb1def8623997d00",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
    amount,
    nonce
  ).send();

  // Update userContext nonce
  userContext.vars.nonce = nonce + 1;

  await checkLastExtrinsicsSuccess(userContext, events);

  return done();
}

async function checkLastExtrinsicsSuccess(userContext, events) {
  const signedBlock = await userContext.api.rpc.chain.getBlock();

  // get the api and events at a specific block
  const apiAt = await userContext.api.at(signedBlock.block.header.hash);
  const allRecords = await apiAt.query.system.events();

  // count the number of failed extrinsics
  let failed_extrinsic = 0;
  // map between the extrinsics and events
  signedBlock.block.extrinsics.forEach(
    ({ method: { method, section } }, index) => {
      allRecords
        // filter the specific events based on the phase and then the
        // index of our extrinsic in the block
        .filter(
          ({ phase }) =>
            phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(index)
        )
        // test the events against the specific types we are looking for
        .forEach(({ event }) => {
          if (userContext.api.events.system.ExtrinsicFailed.is(event)) {
            // extract the data for this event
            const [dispatchError, dispatchInfo] = event.data;
            let errorInfo;

            // decode the error
            if (dispatchError.isModule) {
              // for module errors, we have the section indexed, lookup
              // (For specific known errors, we can also do a check against the
              // api.errors.<module>.<ErrorName>.is(dispatchError.asModule) guard)
              const decoded = userContext.api.registry.findMetaError(
                dispatchError.asModule
              );

              errorInfo = `${decoded.section}.${decoded.name}`;
            } else {
              // Other, CannotLookup, BadOrigin, no extra info
              errorInfo = dispatchError.toString();
            }
            // increase failed extrinsics count
            failed_extrinsic += 1;
            console.log(
              `${section}.${method}:: ExtrinsicFailed:: ${errorInfo}`
            );
          }
        });
    }
  );
  events.emit("counter", "failed_extrinsic", failed_extrinsic);
}

async function _setupToken(userContext, user, contractAddress) {
  const { deployed } = userContext.vars;

  const mintAmount =
    "0x0000000000000000000000000000000000000000000000000000000000001000";
  const tokenClassHash =
    "0x025ec026985a3bf9d0cc1fe17326b245bfdc3ff89b8fde106242a3ea56c5a918";

  // Setup token contract if it doesn't exist
  let tokenAddress;
  if (!deployed[tokenClassHash]) {
    try {
      await declare(userContext.api, user, contractAddress, tokenClassHash);

      tokenAddress = await deploy(
        userContext.api,
        user,
        contractAddress,
        tokenClassHash
      );

      console.log("Deployed token address: ", tokenAddress);

      await initialize(userContext.api, user, contractAddress, tokenAddress);

      await mint(
        userContext.api,
        user,
        contractAddress,
        tokenAddress,
        mintAmount
      );

      // Update userContext deployed dict
      userContext.vars.deployed = {
        ...userContext.vars.deployed,
        [tokenClassHash]: true,
      };
    } catch (error) {
      console.error(error);
    }
  }

  return tokenAddress;
}
