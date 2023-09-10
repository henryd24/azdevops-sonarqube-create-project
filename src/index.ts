import * as tl from "azure-pipelines-task-lib";
import { Projects } from './libs/projects';
import { QualityGate } from './libs/quality_gate'
import { Tags } from "./libs/tags"
import { Settings } from "./libs/settings"

async function run() {
    try {
        const idServiceconnection: string = tl.getInput('Sonarqube', true) ?? '';
        const sonarToken = tl.getEndpointAuthorizationParameter(idServiceconnection,'apitoken',true) ?? '';
        const baseURL = tl.getEndpointUrlRequired(idServiceconnection) ?? '';
        const serviceKey: string | undefined = tl.getInput('serviceKey', true);
        const serviceName: string = tl.getInput('serviceName', false) ?? `${serviceKey}`;
        const createProject: string | undefined = tl.getInput('createProject', true);
        const tags: string | undefined = tl.getInput('tags', false);
        const long_live_branches: string | undefined = tl.getInput('long_live_branches', false);
        const sonarQualityGate: string | undefined = tl.getInput('sonarQualityGate', false);
        let Project = new Projects(baseURL,sonarToken);
        await Project.getSonarProject(serviceKey);

        if(createProject=="false"){
            if(!Project.Created){
                tl.setResult(tl.TaskResult.Failed, `The ${serviceKey} project does NOT exist.`);
            }
        }

        if(createProject=="true"){
            if(!Project.Created){
                console.info(`Creating the ${serviceKey} project`)
                await Project.createSonarProject(serviceKey,serviceName)
            }else{
                console.info(`The creation of ${serviceKey} is omitted.`)
                Project.setSonarProjectConfig(serviceKey)
            }
            if(Project.Created){
                if(tags){
                    let Tag = new Tags(baseURL,sonarToken);
                    await Tag.setTags(serviceKey,tags)
                }
        
                if(sonarQualityGate){
                    let qualityGate = new QualityGate(baseURL,sonarToken);
                    await qualityGate.setQualityGate(serviceKey,sonarQualityGate)
                }

                if(long_live_branches){
                    let settings = new Settings(baseURL,sonarToken);
                    await settings.setLongLiveBranches(serviceKey,long_live_branches)
                }
            }
        }
    }
    catch (err) {
        tl.setResult(tl.TaskResult.Failed, (err as Error).toString());
    }
}
run();