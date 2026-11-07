---
category: literaturenote
tags: {% if allTags %}{{allTags}}{% endif %}
citekey: {{citekey}}
status: unread
dateread:
{%- set readerAtt = (attachments | filterby("path", "endswith", ".pdf") | first) or (attachments | selectattr("path") | first) %}
zotero-select: "{{desktopURI}}"
{%- if readerAtt and readerAtt.desktopURI %}
zotero-reader: "{{ readerAtt.pdfURI or (readerAtt.desktopURI | replace("zotero://select", "zotero://open-pdf")) }}"
{%- endif %}
---

> [!Cite]
> {{bibliography}}

>[!Synth]
>**Contribution**:: 
>
>**Related**:: {% for relation in relations | selectattr("citekey") %} [[@{{relation.citekey}}]]{% if not loop.last %}, {% endif%} {% endfor %}
>

>[!md]
{% for type, creators in creators | groupby("creatorType") -%}
{%- for creator in creators -%}
> **{{"First" if loop.first}}{{type | capitalize}}**::
{%- if creator.name %} {{creator.name}}  
{%- else %} {{creator.lastName}}, {{creator.firstName}}  
{%- endif %}  
{% endfor %}~ 
{%- endfor %}    
> **Title**:: {{title}}  
> **Year**:: {{date | format("YYYY")}}   
> **Citekey**:: {{citekey}} {%- if itemType %}  
> **itemType**:: {{itemType}}{%- endif %}{%- if itemType == "journalArticle" %}  
> **Journal**:: *{{publicationTitle}}* {%- endif %}{%- if volume %}  
> **Volume**:: {{volume}} {%- endif %}{%- if issue %}  
> **Issue**:: {{issue}} {%- endif %}{%- if itemType == "bookSection" %}  
> **Book**:: {{publicationTitle}} {%- endif %}{%- if publisher %}  
> **Publisher**:: {{publisher}} {%- endif %}{%- if place %}  
> **Location**:: {{place}} {%- endif %}{%- if pages %}   
> **Pages**:: {{pages}} {%- endif %}{%- if DOI %}  
> **DOI**:: {{DOI}} {%- endif %}{%- if ISBN %}  
> **ISBN**:: {{ISBN}} {%- endif %}    

> [!LINK] 
> [Show in Zotero]({{desktopURI}})
> {%- for attachment in attachments | selectattr("path") %}
>  [{{attachment.title}}](file://{{attachment.path | replace(" ", "%20")}})
{%- if attachment.desktopURI %} · [Open in Zotero reader]({{ attachment.pdfURI or (attachment.desktopURI | replace("zotero://select", "zotero://open-pdf")) }}){% endif %}  {%- endfor -%}.

> [!Abstract]
> {%- if abstractNote %}
> {{abstractNote}}
> {%- endif -%}.
> 
# Notes
> {%- if markdownNotes %}
>{{markdownNotes}}{%- endif -%}.


# Annotations
{%- macro calloutHeader(type, color) -%}  
{%- if type == "highlight" -%}  
<mark style="background-color: {{color}}">Quote</mark>  
{%- endif -%}

{%- if type == "text" -%}  
Note  
{%- endif -%}  
{%- endmacro -%}

{% persist "annotations" %}
{% set newAnnotations = annotations | filterby("date", "dateafter", lastImportDate) %}
{% if newAnnotations.length > 0 %}

### Imported: {{importDate | format("YYYY-MM-DD h:mm a")}}


{% for a in newAnnotations %}
{%- set base = a.attachment.pdfURI or (a.attachment.desktopURI | replace("zotero://select", "zotero://open-pdf")) %}
{{calloutHeader(a.type, a.color)}}
> {{a.annotatedText}}
{%- if a.attachment.desktopURI %}
{%- if a.source == "zotero" %}
> [p. {{a.pageLabel or a.page or "–"}}]({{base}}?{% if a.page %}page={{a.page}}&{% endif %}annotation={{a.id}})
{%- else %}
> [p. {{a.pageLabel or a.page}}]({{base}}{% if a.page %}?page={{a.page}}{% endif %})
{%- endif %}
{%- endif %}
{% endfor %}
{% endif %}
{% endpersist %}

{# Maintainer notes: _custom/README-template.md. Reader-link background: _custom/README-open-in-zotero-reader.md #}
