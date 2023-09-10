import * as tl from "azure-pipelines-task-lib";
import fetch from 'node-fetch';


export class Projects{
    baseURL: string;
    sonarToken: string;
    Created: boolean
    constructor(baseURL:string, sonarToken:string){
        this.baseURL = baseURL
        this.sonarToken = sonarToken
        this.Created = false;
    }
    async getSonarProject(serviceKey: string|undefined){
        const getPorjectUrl: string = `${this.baseURL}/api/projects/search?projects=${serviceKey}`;
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        await fetch(getPorjectUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        })
        .then(response => response.json())
        .then(result =>{
            if("components" in result){
                for(let i=0; i <= result.components.length-1; i++){
                    if(result.components[i].key == serviceKey){
                        console.info(`Project ${serviceKey} exists`);
                        this.Created = true;
                        break
                    }
                }
            }else{
                console.warn(result)
            }
        })
        .catch(error => {
            tl.setResult(tl.TaskResult.Failed, (error as Error).toString()+ ' - Check your TOKEN or connectivity');
        })
    }

    async createSonarProject(serviceKey: string|undefined,serviceName: string|undefined){
        const mainBranch: string = tl.getInput('mainBranch', true) ?? 'main';
        const newCodeDefinitionType: string = tl.getInput('newCodeDefinitionType', true) ?? 'REFERENCE_BRANCH';
        const newCodeDefinitionValue: string | undefined = newCodeDefinitionType !== 'NUMBER_OF_DAYS' ? undefined : tl.getInput('newCodeDefinitionValue', false);
        const visibility: string = tl.getInput('visibility', true) ?? 'public';
        const createPorjectUrl: string = `${this.baseURL}/api/projects/create?project=${serviceKey}` +
                                        `&name=${serviceName}` +
                                        `&visibility=${visibility}` +
                                        `&mainBranch=${mainBranch}` +
                                        `&newCodeDefinitionType=${newCodeDefinitionType}` +
                                        (newCodeDefinitionValue ? `&newCodeDefinitionValue=${newCodeDefinitionValue}` : '');
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        await fetch(createPorjectUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        })
        .then(response => response.json())
        .then(result =>{
            if("project" in result && result.project.key == serviceKey){
                console.info(`The project ${serviceKey} was successfully created with name ${serviceName}.`);
                this.Created = true;
            }else{
                tl.setResult(tl.TaskResult.Failed, `The project could not be created, error message: ${JSON.stringify(result)}`);
            }
        })
        .catch(error => {
            tl.setResult(tl.TaskResult.Failed, (error as Error).toString());
        })
    }

    async setSonarProjectConfig(serviceKey: string|undefined) {
        const mainBranch: string | undefined = tl.getInput('mainBranch', false);
        const newCodeDefinitionType: string = tl.getInput('newCodeDefinitionType', false) ?? 'REFERENCE_BRANCH';
        const newCodeDefinitionValue: string | undefined = newCodeDefinitionType !== 'NUMBER_OF_DAYS' ? undefined : tl.getInput('newCodeDefinitionValue', false);
        const base64_token: string = Buffer.from(this.sonarToken+':').toString('base64')
        const conf = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + base64_token
            }
        }
        if (mainBranch){
            const mainBranchUrl: string = `${this.baseURL}/api/project_branches/set_main?project=${serviceKey}` +
                                                `&branch=${mainBranch}`;
            await fetch(mainBranchUrl, conf)
            .then(response => response.status)
            .then(status => {
                if (status == 204){
                    console.info(`The main branch ${mainBranchUrl} was successfully configurated.`);
                }else{
                    console.warn(`Can't update main branch, probably because branch '${mainBranch}' not found for project '${serviceKey}'.`)
                }
            })
            .catch(error => {
                console.warn(`Can't update main branch '${mainBranch}', error ${error}.`)
            })
        }
        if (newCodeDefinitionType){
            const newCodeDefinitionUrl: string = `${this.baseURL}/api/new_code_periods/set?project=${serviceKey}` +
                                    `&type=${newCodeDefinitionType}` +
                                    (newCodeDefinitionValue ? `&value=${newCodeDefinitionValue}` : '');
            await fetch(newCodeDefinitionUrl, conf)
            .then(response => response.status)
            .then(status => {
                if (status == 200){
                    console.info(`The new code definition ${newCodeDefinitionType} was successfully configurated.`);
                }else{
                    console.warn(`Can't update new code definition '${newCodeDefinitionType}'.`)
                }
            })
            .catch(error => {
                console.warn(`Can't update new code definition '${newCodeDefinitionType}', error ${error}.`)
            })
        }
    }
 }
