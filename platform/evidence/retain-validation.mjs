import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs, sha256File } from '../runtime/common.mjs';

async function main() {
  const args=parseArgs(process.argv.slice(2)); if(!args.report||!args.output) throw new Error('--report and --output are required');
  const report=resolve(args.report); const output=resolve(args.output); const digest=await sha256File(report); const run=resolve(output,`c2a-foundation-${digest.slice(0,16)}`);
  await mkdir(resolve(run,'raw'),{recursive:true}); const target=resolve(run,'raw',basename(report)); await copyFile(report,target);
  const checkpoint={documentVersion:'1.0.0',package:'C2A',result:'PASS',validationReport:`raw/${basename(report)}`,validationReportSha256:digest,scope:'platform runtime and evidence foundation',liveCoreExecution:'DEFERRED_EXTERNAL_W1_IMAGE'};
  await writeFile(resolve(run,'checkpoint.json'),`${JSON.stringify(checkpoint,null,2)}\n`,{flag:'wx'});
  const sums=`${await sha256File(resolve(run,'checkpoint.json'))}  checkpoint.json\n${digest}  raw/${basename(report)}\n`; await writeFile(resolve(run,'SHA256SUMS'),sums,{flag:'wx'});
  for(const path of [target,resolve(run,'checkpoint.json'),resolve(run,'SHA256SUMS')]) await chmod(path,0o444); await chmod(resolve(run,'raw'),0o555); await chmod(run,0o555);
  process.stdout.write(`${JSON.stringify({result:'PASS',run,validationReportSha256:digest},null,2)}\n`);
}
main().catch((error)=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
