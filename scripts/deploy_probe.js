async function main() {
  const [signer] = await hre.ethers.getSigners();
  console.log('signer:', signer.address);
  const F = await hre.ethers.getContractFactory('P256VerifyProbe');
  const probe = await F.deploy();
  await probe.waitForDeployment();
  console.log('deployed at:', await probe.getAddress());
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
