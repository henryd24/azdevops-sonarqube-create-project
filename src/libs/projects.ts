import * as tl from "azure-pipelines-task-lib";
import fetch from 'node-fetch';


export class Projects{
    baseURL: string;
    Created: boolean
    constructor(){
        this.baseURL = "https://sonarcloud.io";
        this.Created = false;
    }
    async getSonarProject(sonarToken:string|undefined, sonarOrganization: string|undefined ,serviceKey: string|undefined){
        const getPorjectUrl: string = `${this.baseURL}/api/projects/search?organization=${sonarOrganization}&project=${serviceKey}`;
        const base64_token: string = Buffer.from(sonarToken+':').toString('base64')
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
            tl.setResult(tl.TaskResult.Failed, (error as Error).toString());
        })
    }

    async createSonarProject(sonarToken:string|undefined, sonarOrganization: string|undefined ,serviceKey: string|undefined,serviceName: string|undefined,visibility: string|undefined){
        const createPorjectUrl: string = `${this.baseURL}/api/projects/create?organization=${sonarOrganization}&project=${serviceKey}&name=${serviceName}&visibility=${visibility}`;
        const base64_token: string = Buffer.from(sonarToken+':').toString('base64')
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
                this.Created = true;
                console.info(`The project ${serviceKey} was successfully created with name ${serviceName}.`);
            }else{
                tl.setResult(tl.TaskResult.Failed, `The project could not be created, error message: ${JSON.stringify(result)}`);
            }
        })
        .catch(error => {
            tl.setResult(tl.TaskResult.Failed, (error as Error).toString());
        })
    }
 }
