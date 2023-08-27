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
        const getPorjectUrl: string = `${this.baseURL}/api/projects/search?project=${serviceKey}`;
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
            tl.setResult(tl.TaskResult.Failed, (error as Error).toString());
        })
    }

    async createSonarProject(serviceKey: string|undefined,serviceName: string|undefined){
        const createPorjectUrl: string = `${this.baseURL}/api/projects/create?project=${serviceKey}&name=${serviceName}`;
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
